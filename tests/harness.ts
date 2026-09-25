// A ledger for validator tests: scalus's Cardano emulator (full ledger rules — balance, fees,
// signatures, validity, script execution) seeded with arbitrary UTxOs, plus signing keys.
// Replaces the Helios Emulator the v1 suite ran on.
import { readFileSync } from "node:fs";
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

// The parameters the emulator validates with (its embedded mainnet epoch-544 set): fees and the
// script_data_hash must use the same cost model.
const COST_MODEL_V2: number[] = JSON.parse(
  readFileSync(new URL("./fixtures/scalusEmulatorParams.json", import.meta.url), "utf8")
).costModelV2;

export const params: ScriptTxProtocolParameters = {
  minFeeA: BigInt(44),
  minFeeB: BigInt(155381),
  priceMemory: ratio("0.0577"),
  priceSteps: ratio("0.0000721"),
  minFeeRefScriptCostPerByte: ratio(15),
  coinsPerUtxoByte: BigInt(4310),
  stakeKeyDeposit: BigInt(2_000_000),
  maxTxSize: 16384,
  maxTxExUnits: { memory: 14_000_000, steps: 10_000_000_000 },
  costModels: new Map([[Cardano.PlutusLanguageVersion.V2, COST_MODEL_V2]]),
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
