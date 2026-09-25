// What the tx builders return, and how a wallet completes it.
//
// Builders fix the contract side of a tx (script inputs + redeemers, reference inputs, mint,
// withdrawals, certificates, required signers, outputs). `completeTx` adds the wallet: it picks
// wallet inputs for the value the plan still needs, a collateral input when scripts run, and hands
// the whole plan to kora-labs-common's deterministic finalizer, which evaluates every redeemer with
// `evaluate` (the node, via BlockfrostTxClient.evaluateTx — or `localEvaluator` offline), converges
// the fee and returns the unsigned tx.
import {
  certificateDeposit,
  Evaluator,
  FinalizedScriptTx,
  finalizeScriptTx,
  ScriptTxPlan,
  ScriptTxProtocolParameters,
  selectWalletInputs,
} from "@koralabs/kora-labs-common/txBuild";

import {
  Cardano,
  NetworkName,
  Serialization,
  slotFromPosixMs,
  Utxo,
  utxoRef,
} from "../cardano/index.js";

/** The contract side of a tx: a ScriptTxPlan without the wallet (change, collateral, signer count). */
type HalTxPlan = Omit<ScriptTxPlan, "changeAddress" | "signerCount" | "collateral"> & {
  /** Lower validity bound as POSIX ms (converted to a slot by `completeTx`). */
  validFromTime?: number;
};

/** The ledger's size of a reference script (Conway ref-script fee). */
const referenceScriptSize = (script: Cardano.Script) =>
  script.__type === Cardano.ScriptType.Plutus
    ? script.bytes.length / 2
    : Serialization.NativeScript.fromCore(script).toCbor().length / 2;

/**
 * Reference inputs of a plan, plus what the finalizer must know about the scripts they carry: the
 * Plutus languages (script_data_hash language views) and their total size (reference-script fee).
 */
const referTo = (referenceUtxos: Utxo[]) => {
  const scripts = referenceUtxos.flatMap(([, output]) =>
    output.scriptReference ? [output.scriptReference] : []
  );
  return {
    referenceInputs: referenceUtxos.map(([txIn]) => ({ txId: txIn.txId, index: txIn.index })),
    plutusLanguages: [
      ...new Set(
        scripts.flatMap((script) =>
          script.__type === Cardano.ScriptType.Plutus ? [script.version] : []
        )
      ),
    ],
    referenceScriptBytes: scripts.reduce((sum, script) => sum + referenceScriptSize(script), 0),
  };
};

interface CompleteTxParams {
  plan: HalTxPlan;
  network: NetworkName;
  /** The paying wallet's UTxOs (inputs and collateral are chosen from these). */
  walletUtxos: Utxo[];
  changeAddress: string;
  params: ScriptTxProtocolParameters;
  evaluate: Evaluator;
  /** vkey witnesses the signed tx will carry; default: the plan's required signers + the wallet. */
  signerCount?: number;
  /**
   * Lovelace the tx must have beyond its outputs and deposits, for the fee and the change output's
   * min-UTxO (default 5 ADA). The wallet adds inputs only when the plan's own inputs fall short.
   */
  feeAllowance?: bigint;
}

const hasRedeemers = (plan: HalTxPlan) =>
  plan.inputs.some((input) => input.redeemer) ||
  (plan.mint ?? []).some((mint) => mint.redeemer) ||
  (plan.withdrawals ?? []).some((withdrawal) => withdrawal.redeemer);

/**
 * Lovelace the plan's own inputs and withdrawals leave over (negative: short) after its outputs and
 * deposits, before the fee. Outputs below min-UTxO are topped up by the finalizer, so they count at
 * no less than ~1.5 ADA here.
 */
const planBalance = (plan: HalTxPlan, params: ScriptTxProtocolParameters): bigint => {
  const inputs = plan.inputs.reduce((sum, { utxo }) => sum + utxo[1].value.coins, BigInt(0));
  const withdrawn = (plan.withdrawals ?? []).reduce((sum, w) => sum + w.quantity, BigInt(0));
  const deposits = (plan.certificates ?? []).reduce(
    (sum, c) => sum + certificateDeposit(c, params.stakeKeyDeposit),
    BigInt(0)
  );
  const outputs = plan.outputs.reduce(
    (sum, output) => sum + (output.value.coins > BigInt(1_500_000) ? output.value.coins : BigInt(1_500_000)),
    BigInt(0)
  );
  return inputs + withdrawn - outputs - deposits;
};

const COLLATERAL_LOVELACE = BigInt(5_000_000);

/** Add the wallet to `plan` and finalize it into an unsigned tx. */
const completeTx = async ({
  plan,
  network,
  walletUtxos,
  changeAddress,
  params,
  evaluate,
  signerCount,
  feeAllowance = BigInt(5_000_000),
}: CompleteTxParams): Promise<FinalizedScriptTx> => {
  // Wallet inputs only for what the plan cannot pay itself (a mint pays its fee from the orders).
  const planned = new Set(plan.inputs.map(({ utxo }) => utxoRef(utxo)));
  const needed = feeAllowance - planBalance(plan, params);
  const walletInputs = needed > BigInt(0) ? selectWalletInputs(walletUtxos, needed, planned) : [];
  let collateral: Cardano.TxIn[] | undefined;
  if (hasRedeemers(plan)) {
    const candidate = walletUtxos
      .filter(([, output]) => !output.value.assets?.size && output.value.coins >= COLLATERAL_LOVELACE)
      .sort((a, b) => (a[1].value.coins > b[1].value.coins ? -1 : 1))[0];
    if (!candidate) throw new Error("Wallet has no ADA-only UTxO of at least 5 ADA for collateral");
    collateral = [{ txId: candidate[0].txId, index: candidate[0].index }];
  }
  const { validFromTime, ...rest } = plan;
  return finalizeScriptTx(
    {
      ...rest,
      inputs: [...plan.inputs, ...walletInputs.map((utxo) => ({ utxo }))],
      ...(validFromTime !== undefined
        ? {
            validityInterval: {
              ...plan.validityInterval,
              invalidBefore: Cardano.Slot(slotFromPosixMs(validFromTime, network)),
            },
          }
        : {}),
      ...(collateral ? { collateral } : {}),
      changeAddress,
      signerCount: signerCount ?? new Set(plan.requiredSigners ?? []).size + 1,
    },
    params,
    evaluate
  );
};

export type { CompleteTxParams, HalTxPlan };
export { completeTx, referTo, referenceScriptSize };
