// Pure off-chain helpers: bigint min/max, sync mayFail and staking-registration classification.
import { describe, expect, test, vi } from "vitest";

import { mayFail } from "../src/helpers/error/index.js";
import { checkAccountRegistrationStatus, maxBigInt, minBigInt } from "../src/utils/index.js";

describe("bigint helpers", () => {
  test("pick the extreme across values, including negatives and a single value", () => {
    expect(minBigInt(5n, -3n, 9n)).toBe(-3n);
    expect(maxBigInt(5n, -3n, 9n)).toBe(9n);
    expect(minBigInt(7n)).toBe(7n);
    expect(maxBigInt(7n)).toBe(7n);
  });
  test("refuse an empty list", () => {
    expect(() => minBigInt()).toThrow("At least one value must be provided");
    expect(() => maxBigInt()).toThrow("At least one value must be provided");
  });
});

describe("mayFail", () => {
  test("returns data on success and never calls the handler", () => {
    const handler = vi.fn();
    const r = mayFail(() => 42).handle(handler);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(42);
    expect(handler).not.toHaveBeenCalled();
  });
  test("converts a throw to its message and passes it to the handler", () => {
    const handler = vi.fn();
    const r = mayFail(() => {
      throw new Error("sync boom");
    }).handle(handler);
    expect(r.ok).toBe(false);
    expect(handler).toHaveBeenCalledWith("sync boom");
  });
});

describe("checkAccountRegistrationStatus", () => {
  test("classifies each staking address independently", async () => {
    const accounts: Record<string, { active: boolean } | undefined> = {
      mint: { active: true },
      ref: { active: false },
    };
    const getAccount = vi.fn(async (a: string) => accounts[a]);
    expect(await checkAccountRegistrationStatus({ getAccount } as never, "mint", "ref")).toEqual({
      mintStakingAddress: "registered",
      refSpendStakingAddress: "deregistered",
    });
    expect(await checkAccountRegistrationStatus({ getAccount } as never, "ref", "unknown")).toEqual({
      mintStakingAddress: "deregistered",
      refSpendStakingAddress: "none",
    });
  });
});
