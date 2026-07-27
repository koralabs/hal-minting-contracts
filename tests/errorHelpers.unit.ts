import { describe, expect, test, vi } from "vitest";

import {
  BuildTxError,
  convertError,
  mayFailAsync,
  mayFailTransaction,
} from "../src/helpers/error/index.js";

describe("error helper coverage", () => {
  test("index exports convertError and handles unusual values", () => {
    expect(convertError({ message: "from message", code: 500 })).toBe(
      "from message"
    );
    expect(convertError(BigInt(123))).toBe("123");
    expect(convertError({ value: "ok" })).toContain('"value":"1"');
    expect(convertError({ value: "ok" })).toContain('"ok"');
  });

  test("mayFailAsync completes success and reports failures to handlers", async () => {
    const successHandler = vi.fn();
    const success = await mayFailAsync(async () => "ok")
      .handle(successHandler)
      .complete();

    expect(success.ok).toBe(true);
    if (success.ok) expect(success.data).toBe("ok");
    expect(successHandler).not.toHaveBeenCalled();

    const failureHandler = vi.fn();
    const failure = await mayFailAsync(async () => {
      throw new Error("async boom");
    })
      .handle(failureHandler)
      .complete();

    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error).toBe("async boom");
    expect(failureHandler).toHaveBeenCalledWith("async boom");
  });

  test("mayFailTransaction notifies handlers for validation errors", async () => {
    const failedTx = {
      hasValidationError: new Error("bad redeemer"),
      toCbor: () => Uint8Array.from([0xde, 0xad]),
      dump: () => ({ failed: true }),
    };
    const txBuilder = {
      buildUnsafe: vi.fn(async () => failedTx),
    };
    const handler = vi.fn();

    const result = await mayFailTransaction(txBuilder as never, {} as never, [])
      .handle(handler)
      .complete();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(BuildTxError);
      expect(result.error.message).toContain("bad redeemer");
      expect((result.error as BuildTxError).failedTxCbor).toBe("dead");
      expect((result.error as BuildTxError).failedTxJson).toEqual({
        failed: true,
      });
      expect(handler).toHaveBeenCalledWith(result.error);
    }
    expect(txBuilder.buildUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        changeAddress: {},
        spareUtxos: [],
        throwBuildPhaseScriptErrors: false,
      })
    );
  });
});
