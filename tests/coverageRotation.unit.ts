import { makeDummyAddress } from "@helios-lang/ledger";
import { afterEach, describe, expect, test, vi } from "vitest";

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe("coverage rotation gaps", () => {
  afterEach(() => {
    vi.doUnmock("dotenv");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("config helper covers env parsing and load failures", async () => {
    vi.resetModules();
    const configMock = vi.fn();
    vi.doMock("dotenv", () => ({ config: configMock }));

    const previousString = process.env.COVERAGE_ROTATION_STRING;
    const previousNumber = process.env.COVERAGE_ROTATION_NUMBER;
    const previousBadNumber = process.env.COVERAGE_ROTATION_BAD_NUMBER;
    const previousMissing = process.env.COVERAGE_ROTATION_MISSING;

    try {
      process.env.COVERAGE_ROTATION_STRING = "abc";
      process.env.COVERAGE_ROTATION_NUMBER = "42";
      process.env.COVERAGE_ROTATION_BAD_NUMBER = "forty-two";
      delete process.env.COVERAGE_ROTATION_MISSING;

      const { get, has, loadEnv } = await import(
        "../src/helpers/config/index.js"
      );

      loadEnv({ path: ".env.coverage" });
      expect(configMock).toHaveBeenCalledWith({ path: ".env.coverage" });

      configMock.mockImplementationOnce(() => {
        throw new Error("missing env file");
      });
      expect(() => loadEnv()).not.toThrow();

      expect(has("COVERAGE_ROTATION_STRING")).toBe(true);
      expect(has("COVERAGE_ROTATION_MISSING")).toBe(false);

      const stringResult = get("COVERAGE_ROTATION_STRING", "string");
      expect(stringResult.ok).toBe(true);
      if (stringResult.ok) expect(stringResult.data).toBe("abc");

      const numberResult = get("COVERAGE_ROTATION_NUMBER", "number");
      expect(numberResult.ok).toBe(true);
      if (numberResult.ok) expect(numberResult.data).toBe(42);

      const badNumberResult = get("COVERAGE_ROTATION_BAD_NUMBER", "number");
      expect(badNumberResult.ok).toBe(false);
      if (!badNumberResult.ok) {
        expect(badNumberResult.error).toContain("not number type");
      }

      const missingResult = get("COVERAGE_ROTATION_MISSING", "string");
      expect(missingResult.ok).toBe(false);
      if (!missingResult.ok) {
        expect(missingResult.error).toBe("COVERAGE_ROTATION_MISSING is not set.");
      }
    } finally {
      restoreEnv("COVERAGE_ROTATION_STRING", previousString);
      restoreEnv("COVERAGE_ROTATION_NUMBER", previousNumber);
      restoreEnv("COVERAGE_ROTATION_BAD_NUMBER", previousBadNumber);
      restoreEnv("COVERAGE_ROTATION_MISSING", previousMissing);
    }
  });

  test("mayFail invokes handlers only for failed callbacks", async () => {
    const { mayFail } = await import("../src/helpers/error/handleable.js");

    const successHandler = vi.fn();
    const success = mayFail(() => 2).handle(successHandler);
    expect(success.ok).toBe(true);
    if (success.ok) expect(success.data).toBe(2);
    expect(successHandler).not.toHaveBeenCalled();

    const failureHandler = vi.fn();
    const failure = mayFail(() => {
      throw new Error("boom");
    }).handle(failureHandler);

    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error).toBe("boom");
    expect(failureHandler).toHaveBeenCalledWith("boom");
  });

  test("mayFailTransaction reports success, build errors, and validation errors", async () => {
    const { BuildTxError, mayFailTransaction } = await import(
      "../src/helpers/error/tx.js"
    );
    const changeAddress = makeDummyAddress(false);

    const okTx = {
      hasValidationError: false,
      dump: () => ({ ok: true }),
      toCbor: () => Buffer.from("aa", "hex"),
    };
    const successBuilder = {
      buildUnsafe: vi.fn(async (options) => {
        expect(options.changeAddress).toBe(changeAddress);
        expect(options.spareUtxos).toEqual([]);
        expect(options.throwBuildPhaseScriptErrors).toBe(false);
        options.logOptions.logPrint("success log");
        return okTx;
      }),
    };
    const successHandler = vi.fn();
    const success = await mayFailTransaction(
      successBuilder as never,
      changeAddress,
      []
    )
      .handle(successHandler)
      .complete();
    expect(success.ok).toBe(true);
    expect(successHandler).not.toHaveBeenCalled();

    const buildHandler = vi.fn();
    const buildFailure = await mayFailTransaction(
      {
        buildUnsafe: vi.fn(async () => {
          throw new Error("bad build");
        }),
      } as never,
      changeAddress,
      []
    )
      .handle(buildHandler)
      .complete();
    expect(buildFailure.ok).toBe(false);
    if (!buildFailure.ok) {
      expect(buildFailure.error.message).toBe("Tx Build Error: bad build");
    }
    expect(buildHandler).toHaveBeenCalledOnce();

    const failedTx = {
      hasValidationError: new Error("phase two failed"),
      dump: () => ({ failed: true }),
      toCbor: () => Buffer.from("bb", "hex"),
    };
    const validationHandler = vi.fn();
    const validationFailure = await mayFailTransaction(
      {
        buildUnsafe: vi.fn(async (options) => {
          options.logOptions.logPrint("first");
          options.logOptions.logPrint("second");
          return failedTx;
        }),
      } as never,
      changeAddress,
      []
    )
      .handle(validationHandler)
      .complete();

    expect(validationFailure.ok).toBe(false);
    if (!validationFailure.ok) {
      expect(validationFailure.error).toBeInstanceOf(BuildTxError);
      expect(validationFailure.error.failedTxCbor).toBe("bb");
      expect(validationFailure.error.failedTxJson).toEqual({ failed: true });
      expect(validationFailure.error.message).toContain("Validation logs");
    }
    expect(validationHandler).toHaveBeenCalledOnce();
  });

  test("utility helpers cover network and account status edge cases", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ slotLength: 1 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const {
      checkAccountRegistrationStatus,
      createAlwaysFailUplcProgram,
      fetchNetworkParameters,
    } = await import("../src/utils/index.js");

    const networkParams = await fetchNetworkParameters("preview");
    expect(networkParams.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://network-status.helios-lang.io/preview/config"
    );

    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const failedNetworkParams = await fetchNetworkParameters("mainnet");
    expect(failedNetworkParams.ok).toBe(false);

    const blockfrostApi = {
      accountsRegistrations: vi
        .fn()
        .mockResolvedValueOnce([{ action: "registered" }])
        .mockResolvedValueOnce([{ action: "deregistered" }]),
    };
    await expect(
      checkAccountRegistrationStatus(
        blockfrostApi as never,
        "stake_test_mint",
        "stake_test_ref"
      )
    ).resolves.toEqual({
      mintStakingAddress: "registered",
      refSpendStakingAddress: "deregistered",
    });

    const failingBlockfrostApi = {
      accountsRegistrations: vi.fn(async () => {
        throw new Error("missing account");
      }),
    };
    await expect(
      checkAccountRegistrationStatus(
        failingBlockfrostApi as never,
        "stake_test_mint",
        "stake_test_ref"
      )
    ).resolves.toEqual({
      mintStakingAddress: "none",
      refSpendStakingAddress: "none",
    });

    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(createAlwaysFailUplcProgram()).toBeDefined();
  });

  test("buildContracts wires real validator programs into contract config", async () => {
    const { buildContracts } = await import("../src/contracts/config.js");

    const contracts = buildContracts({
      isMainnet: false,
      mint_version: 0n,
      admin_verification_key_hash: "00".repeat(28),
      orders_spend_randomizer: "",
      royalty_spend_admin: "11".repeat(28),
    });

    expect(contracts.halPolicyHash.toHex()).toHaveLength(56);
    expect(contracts.mintProxy.mintProxyPolicyHash.toHex()).toBe(
      contracts.halPolicyHash.toHex()
    );
    expect(contracts.mint.mintStakingAddress).toBeDefined();
    expect(contracts.mint.mintRegistrationDCert).toBeDefined();
    expect(contracts.mintingData.mintingDataValidatorAddress.toString()).toContain(
      "addr_test"
    );
    expect(contracts.ordersSpend.ordersSpendValidatorAddress.toString()).toContain(
      "addr_test"
    );
    expect(contracts.refSpend.refSpendStakingAddress).toBeDefined();
    expect(contracts.refSpend.refSpendRegistrationDCert).toBeDefined();
    expect(contracts.royaltySpend.royaltySpendValidatorAddress.toString()).toContain(
      "addr_test"
    );
  });
});
