// Plutus data decoding guards and address <-> data round-trips.
import { describe, expect, test } from "vitest";

import { Cardano, scriptAddress } from "../src/cardano/sdk.js";
import {
  addressFromData,
  addressToData,
  bytes,
  constr,
  expectBytes,
  expectConstr,
  expectInt,
  expectList,
  int,
  list,
} from "../src/cardano/plutusData.js";

const KEY = "11".repeat(28);
const STAKE = "22".repeat(28);
const base = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { type: Cardano.CredentialType.KeyHash, hash: KEY as never },
  { type: Cardano.CredentialType.KeyHash, hash: STAKE as never }
)
  .toAddress()
  .toBech32();

describe("address data", () => {
  test("base address round-trips with its staking credential", () => {
    expect(addressFromData(addressToData(base), Cardano.NetworkId.Testnet)).toBe(base);
  });

  test("script enterprise address round-trips (script credential tag 1, no staking)", () => {
    const addr = scriptAddress(KEY, true);
    expect(addressFromData(addressToData(addr), Cardano.NetworkId.Mainnet)).toBe(addr);
  });

  test("reward addresses cannot be Plutus addresses", () => {
    const reward = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: KEY as never,
    })
      .toAddress()
      .toBech32();
    expect(() => addressToData(reward)).toThrow("Unsupported address type for Plutus Address");
  });

  test("rejects a credential tag above 1 and an unknown staking option tag", () => {
    const badCredential = constr(0, [constr(2, [bytes(KEY)]), constr(1)]);
    expect(() => addressFromData(badCredential, Cardano.NetworkId.Testnet)).toThrow("invalid Credential tag 2");
    const badOption = constr(0, [constr(0, [bytes(KEY)]), constr(2)]);
    expect(() => addressFromData(badOption, Cardano.NetworkId.Testnet)).toThrow("invalid Option tag 2");
  });
});

describe("expect* guards", () => {
  test("constr checks alternative and field count, and rejects non-constr", () => {
    expect(expectConstr(constr(3, [int(1n)]), "x", 3, 1).tag).toBe(3);
    expect(() => expectConstr(int(1n), "x")).toThrow("x must be Constr data");
    expect(() => expectConstr(constr(3), "x", 4)).toThrow("x must be Constr 4, got 3");
    expect(() => expectConstr(constr(3), "x", 3, 1)).toThrow("x must have 1 fields, got 0");
  });

  test("bytes, int and list accept their own type and refuse the others", () => {
    expect(expectBytes(bytes("abcd"), "b")).toBe("abcd");
    expect(() => expectBytes(int(1n), "b")).toThrow("b must be ByteArray data");
    expect(expectInt(int(9n), "i")).toBe(9n);
    expect(() => expectInt(bytes("ab"), "i")).toThrow("i must be Int data");
    expect(expectList(list([int(1n), int(2n)]), "l")).toHaveLength(2);
    expect(() => expectList(int(1n), "l")).toThrow("l must be List data");
  });
});
