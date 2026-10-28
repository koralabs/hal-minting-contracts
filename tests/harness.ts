// A ledger for validator tests: scalus's Cardano emulator (full ledger rules — balance, fees,
// signatures, validity, script execution) seeded with arbitrary UTxOs, plus signing keys.
// Replaces the Helios Emulator the v1 suite ran on.
import { createRequire } from "node:module";

import { Ed25519PrivateKey, ready } from "@cardano-sdk/crypto";
import {
  addVkeyWitnesses,
  localEvaluator,
  ratio,
  ScriptTxProtocolParameters,
} from "@koralabs/kora-labs-common/txBuild";

import { Cardano, completeTx, HalTxPlan, Serialization, slotFromPosixMs, Utxo, utxoRef } from "./v2.js";

const scalus = createRequire(import.meta.url)("scalus");

// The ledger must price and hash (script_data_hash) with exactly the parameters the emulator
// validates with, so read them from an emulator built the same way as `Ledger`'s rather than
// pinning a copy: scalus 1.3 changed its embedded preview parameters (the V2 cost model grew
// from 175 to 332 entries), and the pinned copy made every scripted tx fail "Invalid script data hash".
const EMULATOR_PARAMS = new scalus.Emulator(new Uint8Array([0xa0]), scalus.SlotConfig.preview).getProtocolParameters();

export const params: ScriptTxProtocolParameters = {
  minFeeA: BigInt(EMULATOR_PARAMS.txFeePerByte),
  minFeeB: BigInt(EMULATOR_PARAMS.txFeeFixed),
  priceMemory: ratio(String(EMULATOR_PARAMS.priceMemory)),
  priceSteps: ratio(String(EMULATOR_PARAMS.priceSteps)),
  minFeeRefScriptCostPerByte: ratio(EMULATOR_PARAMS.minFeeRefScriptCostPerByte),
  coinsPerUtxoByte: BigInt(EMULATOR_PARAMS.utxoCostPerByte),
  stakeKeyDeposit: BigInt(EMULATOR_PARAMS.stakeAddressDeposit),
  maxTxSize: EMULATOR_PARAMS.maxTxSize,
  maxTxExUnits: {
    memory: Number(EMULATOR_PARAMS.maxTxExecutionMemory),
    steps: Number(EMULATOR_PARAMS.maxTxExecutionSteps),
  },
  costModels: new Map([[Cardano.PlutusLanguageVersion.V2, [...EMULATOR_PARAMS.costModels.PlutusV2]]]),
};

export interface Key {
  keyHash: string;
  vkey: string;
  sign: (txIdHex: string) => string;
}

export const makeKey = async (seed: number): Promise<Key> => {
  await ready();
  const privateKey = Ed25519PrivateKey.fromNormalBytes(Buffer.alloc(32, seed));
  const publicKey = privateKey.toPublic();
  return {
    keyHash: publicKey.hash().hex(),
    vkey: publicKey.hex(),
    sign: (txId) => privateKey.sign(txId as never).hex(),
  };
};

const keyCredential = (keyHash: string) => ({ type: Cardano.CredentialType.KeyHash, hash: keyHash as Cardano.Credential["hash"] });

/** A preview base address paying to `payment` and staking to `stake` (default: the same key). */
export const baseAddress = (payment: Key, stake: Key = payment): string =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCredential(payment.keyHash), keyCredential(stake.keyHash))
    .toAddress()
    .toBech32();

const encodeUtxos = (utxos: Utxo[]) => {
  const writer = new Serialization.CborWriter();
  writer.writeStartMap(utxos.length);
  for (const [txIn, txOut] of utxos) {
    writer.writeEncodedValue(Buffer.from(Serialization.TransactionInput.fromCore(txIn).toCbor(), "hex"));
    writer.writeEncodedValue(Buffer.from(Serialization.TransactionOutput.fromCore(txOut).toCbor(), "hex"));
  }
  return writer.encode();
};

let genesisCounter = 0;
/** A UTxO that exists from the start (a fresh fake tx id per call). */
export const genesisUtxo = (output: Cardano.TxOut): Utxo => {
  genesisCounter++;
  const txId = Cardano.TransactionId(genesisCounter.toString(16).padStart(64, "0"));
  return [{ txId, index: 0, address: output.address }, output];
};

export class Ledger {
  private emulator: { submitTx: (tx: Uint8Array) => { isSuccess: boolean; error?: string; logs?: string[] }; setSlot: (slot: number) => void };
  readonly utxos = new Map<string, Utxo>();
  now: number;

  constructor(initial: Utxo[], now = Date.now()) {
    this.emulator = new scalus.Emulator(encodeUtxos(initial), scalus.SlotConfig.preview);
    for (const utxo of initial) this.utxos.set(utxoRef(utxo), utxo);
    this.now = now;
    this.setTime(now);
  }

  setTime(posixMs: number) {
    this.now = posixMs;
    this.emulator.setSlot(slotFromPosixMs(posixMs, "preview"));
  }

  at(address: string): Utxo[] {
    return [...this.utxos.values()].filter(([, output]) => output.address === address);
  }

  /** Complete `plan` (wallet of `payer`), evaluate its scripts locally, sign with `signers`, submit. */
  async submit(plan: HalTxPlan, payer: { address: string; key: Key }, signers: Key[] = [], changeAddress = payer.address) {
    const built = await completeTx({
      plan,
      network: "preview",
      walletUtxos: this.at(payer.address),
      changeAddress,
      params,
      evaluate: async (tx) => {
        try {
          return await localEvaluator({ utxos: [...this.utxos.values()], costModels: params.costModels, network: "preview" })(tx);
        } catch (error) {
          const { message, logs } = error as { message: string; logs?: string[] };
          throw new Error(`validator rejected: ${message}${logs?.length ? ` — ${logs.join(" | ")}` : ""}`);
        }
      },
      signerCount: new Set([payer.key, ...signers].map((k) => k.keyHash)).size,
    });
    return this.submitBuilt(built.cbor, built.txId, [payer.key, ...signers]);
  }

  submitBuilt(unsignedCbor: string, txId: string, signers: Key[]) {
    const unique = [...new Map(signers.map((k) => [k.keyHash, k])).values()];
    const signed = addVkeyWitnesses(unsignedCbor, unique.map((k) => ({ vkey: k.vkey, signature: k.sign(txId) })));
    const result = this.emulator.submitTx(Buffer.from(signed, "hex"));
    if (!result.isSuccess) throw new Error(`ledger rejected ${txId}: ${result.error}${result.logs?.length ? `\n${result.logs.join("\n")}` : ""}`);
    const body = Serialization.Transaction.fromCbor(signed as Serialization.TxCBOR).body().toCore();
    for (const input of body.inputs) this.utxos.delete(`${input.txId}#${input.index}`);
    body.outputs.forEach((output, index) => {
      const txIn = { txId: Cardano.TransactionId(txId), index, address: output.address };
      this.utxos.set(`${txId}#${index}`, [txIn, output]);
    });
    return { txId, body };
  }
}
