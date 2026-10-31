import { describe, expect, test, vi } from "vitest";

import { invariant } from "../src/helpers/common/invariant.js";
import { mayFail } from "../src/helpers/error/handleable.js";
import { parseMPTProofJSON } from "../src/contracts/types/mpt.js";
import {
  getAvailableWhitelistedValue,
  updateWhitelistedValue,
  useWhitelistedValueAsPossible,
} from "../src/txs/whitelist.js";
import { maxBigInt, minBigInt } from "../src/utils/math.js";

describe("bigint math", () => {
  test("min and max pick the right value and reject empty input", () => {
    expect(minBigInt(5n, 2n, 9n)).toBe(2n);
    expect(maxBigInt(5n, 2n, 9n)).toBe(9n);
    expect(() => minBigInt()).toThrow("At least one value");
    expect(() => maxBigInt()).toThrow("At least one value");
  });
});

describe("invariant and mayFail", () => {
  test("invariant passes on truth and builds messages lazily on failure", () => {
    expect(() => invariant(true)).not.toThrow();
    expect(() => invariant(false)).toThrow(/^Invariant failed$/);
    expect(() => invariant(0, "plain")).toThrow("Invariant failed: plain");
    expect(() => invariant(null, () => "lazy")).toThrow("Invariant failed: lazy");
  });

  test("mayFail wraps results and only calls the handler on failure", () => {
    const handler = vi.fn();
    const ok = mayFail(() => 7).handle(handler);
    expect(ok.ok && ok.data).toBe(7);
    expect(handler).not.toHaveBeenCalled();
    const bad = mayFail(() => {
      throw new Error("nope");
    }).handle(handler);
    expect(bad.ok).toBe(false);
    expect(handler).toHaveBeenCalledWith("nope");
  });
});

describe("MPT proof parsing", () => {
  test("parses each step type and rejects malformed steps", () => {
    const neighbor = { key: "aa", value: "bb" };
    expect(
      parseMPTProofJSON([
        { type: "branch", skip: 1, neighbors: "ff" },
        { type: "fork", skip: 2, neighbor: { nibble: 1, prefix: "p", root: "r" } },
        { type: "leaf", skip: 3, neighbor },
      ])
    ).toEqual([
      { type: "branch", skip: 1, neighbors: "ff" },
      { type: "fork", skip: 2, neighbor: { nibble: 1, prefix: "p", root: "r" } },
      { type: "leaf", skip: 3, key: "aa", value: "bb" },
    ]);
    expect(() => parseMPTProofJSON({})).toThrow("not an array");
    expect(() => parseMPTProofJSON([{ type: "branch" }])).toThrow("skip field");
    expect(() => parseMPTProofJSON([{ skip: 1 }])).toThrow("type field");
    expect(() => parseMPTProofJSON([{ skip: 1, type: "branch" }])).toThrow("neighbors field");
    expect(() => parseMPTProofJSON([{ skip: 1, type: "fork" }])).toThrow("neighbor field");
    expect(() => parseMPTProofJSON([{ skip: 1, type: "leaf" }])).toThrow("neighbor field");
    expect(() => parseMPTProofJSON([{ skip: 1, type: "zzz" }])).toThrow("type is invalid");
  });
});

describe("whitelist arithmetic", () => {
  const items = [
    { amount: 2, price: 10n, time_gap: 100 },
    { amount: 0, price: 1n, time_gap: 100 },
    { amount: 5, price: 20n, time_gap: 50 },
  ];

  test("spends usable items in order and keeps leftovers and expired items", () => {
    const r = updateWhitelistedValue(items, 3, 60);
    expect(r.spentLovelaceForWhitelisted).toBe(20n); // only item 1 (gap 60<=100) usable: 2*10
    expect(r.remainingOrderedAmount).toBe(1);
    expect(r.newWhitelistedValue).toEqual([{ amount: 5, price: 20n, time_gap: 50 }]);
  });

  test("partial use leaves a reduced item; ignoring time gaps uses the cheapest possible", () => {
    const partial = updateWhitelistedValue(items, 1, 0);
    expect(partial.newWhitelistedValue).toEqual([
      { amount: 1, price: 10n, time_gap: 100 },
      { amount: 5, price: 20n, time_gap: 50 },
    ]);
    expect(partial.spentLovelaceForWhitelisted).toBe(10n);
    const any = useWhitelistedValueAsPossible(items, 4);
    expect(any.spentLovelaceForWhitelisted).toBe(2n * 10n + 2n * 20n);
    expect(any.remainingOrderedAmount).toBe(0);
  });

  test("available items exclude empty and expired ones", () => {
    expect(getAvailableWhitelistedValue(items, 60)).toEqual([items[0]]);
  });
});
