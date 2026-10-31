// Plutus data encodings shared by every datum/redeemer: each build/decode pair must round-trip and bad tags must be refused.
import { describe, expect, it } from "vitest";

import {
  buildAddressData,
  buildCredentialData,
  buildDatumData,
  buildingStakingCredentialData,
  bytes,
  Cardano,
  constr,
  decodeAddressFromData,
  decodeCredentialFromData,
  decodeDatumFromData,
  decodeStakingCredentialFromData,
  int,
  makeOptionData,
  makeRedeemerWrapper,
  makeVoidData,
} from "../src/index.js";

const key: Cardano.Credential = { type: Cardano.CredentialType.KeyHash, hash: "1".repeat(56) as Cardano.Credential["hash"] };
const script: Cardano.Credential = { type: Cardano.CredentialType.ScriptHash, hash: "2".repeat(56) as Cardano.Credential["hash"] };

describe("common Plutus data", () => {
  // Invariant: key credentials use constructor 0 and script credentials constructor 1, and both decode back.
  it("round-trips key and script credentials with the right constructor tag", () => {
    expect(buildCredentialData(key).toCbor().startsWith("d8799f")).toBe(true);
    expect(buildCredentialData(script).toCbor().startsWith("d87a9f")).toBe(true);
    expect(decodeCredentialFromData(buildCredentialData(key))).toEqual(key);
    expect(decodeCredentialFromData(buildCredentialData(script))).toEqual(script);
    expect(() => decodeCredentialFromData(constr(2, [bytes("11".repeat(28))]))).toThrow("Invalid Credential Constr Tag");
  });

  it("round-trips an optional staking credential and treats None as undefined", () => {
    expect(decodeStakingCredentialFromData(buildingStakingCredentialData(key))).toEqual(key);
    expect(decodeStakingCredentialFromData(buildingStakingCredentialData(script))).toEqual(script);
    expect(decodeStakingCredentialFromData(buildingStakingCredentialData(undefined))).toBeUndefined();
  });

  // Invariant: falsy-but-present values (0) are Some, not None (the old Helios bug this guards).
  it("encodes 0 as Some and undefined as None", () => {
    expect(makeOptionData(0, (n) => int(n)).toCbor()).not.toBe(makeOptionData(undefined, (n: number) => int(n)).toCbor());
  });

  // Invariant: an address survives encoding and decodes to the same bech32 only for its own network.
  it("round-trips a base address and rejects decoding it as the other network's address", () => {
    const base = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, key, script).toAddress().toBech32();
    expect(decodeAddressFromData(buildAddressData(base), true)).toBe(base);
    expect(decodeAddressFromData(buildAddressData(base), false)).not.toBe(base);
  });

  it("round-trips none/hash/inline output datums and refuses an unknown tag", () => {
    expect(decodeDatumFromData(buildDatumData(undefined))).toBeUndefined();
    expect(decodeDatumFromData(buildDatumData({ kind: "hash", hash: "ab".repeat(32) }))).toEqual({ kind: "hash", hash: "ab".repeat(32) });
    const inline = decodeDatumFromData(buildDatumData({ kind: "inline", data: int(7) }));
    expect(inline?.kind === "inline" && inline.data.toCbor()).toBe(int(7).toCbor());
    expect(() => decodeDatumFromData(constr(3))).toThrow("Invalid Datum Constr Tag");
  });

  it("builds the void value and wraps redeemers in constructor 1", () => {
    expect(makeVoidData().toCbor()).toBe("d87980");
    expect(makeRedeemerWrapper(int(5)).toCbor()).toBe(constr(1, [int(5)]).toCbor());
  });
});
