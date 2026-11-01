// Cardano SDK wrapper helpers: address/credential round-trips, UTxO refs, slot arithmetic.
import { describe, expect, test } from "vitest";

import {
  Cardano,
  assetId,
  holdsAsset,
  inlineDatumOf,
  networkNameOf,
  paymentCredentialOf,
  posixMsFromSlot,
  scriptAddress,
  scriptRewardAccount,
  scriptStakeRegistration,
  slotFromPosixMs,
  stakeCredentialOf,
  utxoRef,
  parseUtxoRef,
  type Utxo,
} from "../src/cardano/sdk.js";

const HASH = "ab".repeat(28);
const TX = "cd".repeat(32);

describe("script addresses and credentials", () => {
  test("a script address round-trips to its script-hash payment credential on each network", () => {
    const testnet = scriptAddress(HASH, false);
    const mainnet = scriptAddress(HASH, true);
    expect(testnet.startsWith("addr_test1")).toBe(true);
    expect(mainnet.startsWith("addr1")).toBe(true);
    expect(paymentCredentialOf(mainnet)).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: HASH });
  });

  test("rejects an address that is neither base nor enterprise (negative control: reward address)", () => {
    expect(() => paymentCredentialOf(scriptRewardAccount(HASH, false))).toThrow("Unsupported address type");
  });

  test("a script reward account round-trips to its stake credential; a non-reward address is refused", () => {
    const reward = scriptRewardAccount(HASH, true);
    expect(reward.startsWith("stake1")).toBe(true);
    expect(stakeCredentialOf(reward)).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: HASH });
    expect(() => stakeCredentialOf(scriptAddress(HASH, false))).toThrow("Not a stake address");
  });

  test("stake registration certificate carries the script credential", () => {
    expect(scriptStakeRegistration(HASH)).toEqual({
      __typename: Cardano.CertificateType.StakeRegistration,
      stakeCredential: { type: Cardano.CredentialType.ScriptHash, hash: HASH },
    });
  });
});

describe("utxo references", () => {
  test("parse and format a reference; reject malformed ones", () => {
    expect(parseUtxoRef(`${TX}#3`)).toEqual({ txId: TX, index: 3 });
    expect(() => parseUtxoRef("nothex#0")).toThrow("Invalid UTxO reference");
    expect(() => parseUtxoRef(`${TX}#x`)).toThrow("Invalid UTxO reference");
    expect(() => parseUtxoRef(TX)).toThrow("Invalid UTxO reference");
  });

  const unit = assetId(HASH, "6162");
  const base = (assets?: Map<Cardano.AssetId, bigint>, datum?: unknown): Utxo =>
    [
      { txId: TX as Cardano.TransactionId, index: 1, address: scriptAddress(HASH, false) as Cardano.PaymentAddress },
      { address: scriptAddress(HASH, false) as Cardano.PaymentAddress, value: { coins: 1n, assets }, datum } as Cardano.TxOut,
    ] as Utxo;

  test("utxoRef formats txId#index", () => {
    expect(utxoRef(base())).toBe(`${TX}#1`);
  });

  test("holdsAsset honours the quantity threshold and absent assets", () => {
    const utxo = base(new Map([[unit, 2n]]));
    expect(holdsAsset(utxo, unit)).toBe(true);
    expect(holdsAsset(utxo, unit, 2n)).toBe(true);
    expect(holdsAsset(utxo, unit, 3n)).toBe(false);
    expect(holdsAsset(base(), unit)).toBe(false);
  });

  test("inlineDatumOf is undefined without a datum and decodes an inline one", () => {
    expect(inlineDatumOf(base())).toBeUndefined();
    const decoded = inlineDatumOf(base(undefined, 7n as never));
    expect(decoded?.asInteger()).toBe(7n);
  });
});

describe("slots and networks", () => {
  test.each(["mainnet", "preview", "preprod"] as const)("slot arithmetic round-trips on %s", (network) => {
    const ms = posixMsFromSlot(1000, network);
    expect(slotFromPosixMs(ms, network)).toBe(1000);
    expect(slotFromPosixMs(ms + 999, network)).toBe(1000);
    expect(slotFromPosixMs(ms + 1000, network)).toBe(1001);
  });

  test("network names are case-insensitive and unknown ones are refused", () => {
    expect(networkNameOf("PreView")).toBe("preview");
    expect(() => networkNameOf("devnet")).toThrow("Unknown network devnet");
  });
});
