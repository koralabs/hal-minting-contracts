import {
  makeAddress,
  makeDummyAddress,
  makeAssetClass,
  makeAssets,
  makeInlineTxOutputDatum,
  makePubKeyHash,
  makeValidatorHash,
  makeValue,
} from "@helios-lang/ledger";
import { makeByteArrayData, makeConstrData } from "@helios-lang/uplc";
import { afterEach, describe, expect, test, vi } from "vitest";

const VOID_DATA = makeConstrData(0, []);

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const makeOrderInput = (
  amount: number,
  lovelace: bigint,
  destinationAddress = makeAddress(false, makePubKeyHash("1".repeat(56)))
) => {
  const orderDatum = {
    owner_key_hash: destinationAddress.spendingCredential.toHex(),
    destination_address: destinationAddress,
    amount,
  };

  return {
    id: { toString: () => `tx-${amount}-${lovelace}` },
    address: makeAddress(false, makeValidatorHash("a".repeat(56))),
    datum: Object.assign(makeInlineTxOutputDatum(VOID_DATA), {
      __orderDatum: orderDatum,
    }),
    value: makeValue(lovelace),
  };
};

const makeMockTxBuilder = () => ({
  addSigners: vi.fn(),
  mintPolicyTokensUnsafe: vi.fn(),
  payUnsafe: vi.fn(),
  refer: vi.fn(),
  spendUnsafe: vi.fn(),
  withdrawUnsafe: vi.fn(),
});

const makeTxInput = (
  address = makeAddress(false, makePubKeyHash("1".repeat(56))),
  value = makeValue(1n),
  datum = makeInlineTxOutputDatum(VOID_DATA)
) => ({
  id: { toString: () => "tx#0" },
  address,
  datum,
  value,
});

describe("coverage rotation gaps", () => {
  afterEach(() => {
    vi.doUnmock("@helios-lang/tx-utils");
    vi.doUnmock("../src/contracts/index.js");
    vi.doUnmock("../src/helpers/api.js");
    vi.doUnmock("cross-fetch");
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

  test("contract API helpers merge request options and reject missing scripts", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.doMock("cross-fetch", () => ({ fetch: fetchMock }));

    const previousApiEndpoint = process.env.HANDLE_API_ENDPOINT;
    const previousApiKey = process.env.HANDLE_ME_API_KEY;
    const previousUserAgent = process.env.KORA_USER_AGENT;

    try {
      process.env.HANDLE_API_ENDPOINT = "https://api.example";
      process.env.HANDLE_ME_API_KEY = "api-key";
      process.env.KORA_USER_AGENT = "coverage-agent";

      const { fetchApi } = await import("../src/helpers/api.js");
      await fetchApi("scripts", {
        headers: { "x-extra": "1" },
        method: "POST",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example/scripts",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "coverage-agent",
            "api-key": "api-key",
            "x-extra": "1",
          }),
          method: "POST",
        })
      );
    } finally {
      restoreEnv("HANDLE_API_ENDPOINT", previousApiEndpoint);
      restoreEnv("HANDLE_ME_API_KEY", previousApiKey);
      restoreEnv("KORA_USER_AGENT", previousUserAgent);
    }

    vi.resetModules();
    const deployedScript = {
      refScriptUtxo: "tx#0",
      type: "HAL_MINT",
      validatorHash: "a".repeat(56),
    };
    const fetchApi = vi.fn(async () => ({
      json: async () => deployedScript,
    }));
    vi.doMock("../src/helpers/api.js", () => ({ fetchApi }));

    const { fetchDeployedScript } = await import("../src/utils/contract.js");
    await expect(fetchDeployedScript("HAL_MINT" as never)).resolves.toBe(
      deployedScript
    );
    expect(fetchApi).toHaveBeenCalledWith("scripts?latest=true&type=HAL_MINT");

    fetchApi.mockResolvedValueOnce({ json: async () => null });
    await expect(fetchDeployedScript("HAL_REF" as never)).rejects.toThrow(
      "HAL_REF script details not deployed"
    );
  });

  test("order tx builders cover decode failures, address guards, and success paths", async () => {
    vi.resetModules();
    const ownerAddress = makeAddress(false, makePubKeyHash("1".repeat(56)));
    const otherAddress = makeAddress(false, makePubKeyHash("2".repeat(56)));
    const ordersSpendAddress = makeAddress(
      false,
      makeValidatorHash("a".repeat(56))
    );
    const orderTxInput = makeTxInput(ordersSpendAddress);
    const txBuilder = makeMockTxBuilder();

    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return { ...original, makeTxBuilder: vi.fn(() => txBuilder) };
    });

    const decodeOrderDatumData = vi.fn(() => ({
      amount: 1,
      destination_address: ownerAddress,
      owner_key_hash: ownerAddress.spendingCredential.toHex(),
    }));
    const decodeSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeSettingsV1Data = vi.fn(() => ({
      allowed_minter: "3".repeat(56),
      orders_spend_script_hash: "a".repeat(56),
    }));
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        buildOrderDatumData: vi.fn(() => VOID_DATA),
        buildOrdersSpendCancelOrderRedeemer: vi.fn(() => VOID_DATA),
        buildOrdersSpendRefundOrderRedeemer: vi.fn(() => VOID_DATA),
        decodeOrderDatumData,
        decodeSettingsDatum,
        decodeSettingsV1Data,
      };
    });

    const { cancel, refund, request } = await import("../src/txs/order.js");
    const deployedScripts = {
      ordersSpendScriptDetails: { validatorHash: "a".repeat(56) },
      ordersSpendScriptTxInput: orderTxInput,
    };

    decodeSettingsV1Data.mockImplementationOnce(() => {
      throw new Error("bad settings v1");
    });
    const requestFailure = await request({
      isMainnet: false,
      maxOrderAmountInOneTx: 3,
      orders: [{ amount: 1, cost: 1n, destinationAddress: ownerAddress }],
      settings: { data: VOID_DATA } as never,
    });
    expect(requestFailure.ok).toBe(false);

    const cancelResult = await cancel({
      isMainnet: false,
      address: ownerAddress,
      orderTxInput: orderTxInput as never,
      deployedScripts: deployedScripts as never,
    });
    expect(cancelResult.ok).toBe(true);
    expect(txBuilder.refer).toHaveBeenCalledWith(orderTxInput);
    expect(txBuilder.spendUnsafe).toHaveBeenCalledWith(orderTxInput, VOID_DATA);

    const cancelWrongAddress = await cancel({
      isMainnet: false,
      address: ownerAddress,
      orderTxInput: makeTxInput(otherAddress) as never,
      deployedScripts: deployedScripts as never,
    });
    expect(cancelWrongAddress.ok).toBe(false);

    decodeOrderDatumData.mockImplementationOnce(() => {
      throw new Error("bad datum");
    });
    const cancelBadDatum = await cancel({
      isMainnet: false,
      address: ownerAddress,
      orderTxInput: orderTxInput as never,
      deployedScripts: deployedScripts as never,
    });
    expect(cancelBadDatum.ok).toBe(false);

    decodeSettingsV1Data.mockImplementationOnce(() => {
      throw new Error("bad refund settings");
    });
    const refundBadSettings = await refund({
      isMainnet: false,
      orderTxInput: orderTxInput as never,
      refundingAddress: ownerAddress as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: orderTxInput as never,
    });
    expect(refundBadSettings.ok).toBe(false);

    const refundWrongOwner = await refund({
      isMainnet: false,
      orderTxInput: orderTxInput as never,
      refundingAddress: otherAddress as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: orderTxInput as never,
    });
    expect(refundWrongOwner.ok).toBe(false);

    const refundResult = await refund({
      isMainnet: false,
      orderTxInput: orderTxInput as never,
      refundingAddress: ownerAddress as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: orderTxInput as never,
    });
    expect(refundResult.ok).toBe(true);
    expect(txBuilder.addSigners).toHaveBeenCalled();
  });

  test("ref spend update covers settings v1, reference asset, and success branches", async () => {
    vi.resetModules();
    const txBuilder = makeMockTxBuilder();
    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return { ...original, makeTxBuilder: vi.fn(() => txBuilder) };
    });

    const policyId = "5".repeat(56);
    const decodeRefSpendSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeRefSpendSettingsV1Data = vi.fn(() => ({
      policy_id: policyId,
      ref_spend_admin: "6".repeat(56),
    }));
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeRefSpendSettingsDatum,
        decodeRefSpendSettingsV1Data,
        makeVoidData: vi.fn(() => VOID_DATA),
      };
    });

    const { update } = await import("../src/txs/ref_spend.js");
    const address = makeAddress(false, makePubKeyHash("7".repeat(56)));
    const refAssetName = `000643b0${Buffer.from("hal-1").toString("hex")}`;
    const refAssets = makeAssets([
      [makeAssetClass(`${policyId}.${refAssetName}`), 1n],
    ]);
    const refTxInput = makeTxInput(address, makeValue(0n, refAssets));
    const settingsTxInput = makeTxInput();
    const deployedScripts = {
      refSpendProxyScriptTxInput: settingsTxInput,
      refSpendScriptDetails: { validatorHash: "a".repeat(56) },
      refSpendScriptTxInput: settingsTxInput,
    };

    decodeRefSpendSettingsV1Data.mockImplementationOnce(() => {
      throw new Error("bad ref settings v1");
    });
    const badSettings = await update({
      isMainnet: false,
      assetUtf8Name: "hal-1",
      refTxInput: refTxInput as never,
      newDatum: makeInlineTxOutputDatum(VOID_DATA),
      deployedScripts: deployedScripts as never,
      refSpendSettingsAssetTxInput: settingsTxInput as never,
    });
    expect(badSettings.ok).toBe(false);

    const missingAsset = await update({
      isMainnet: false,
      assetUtf8Name: "hal-1",
      refTxInput: makeTxInput(address) as never,
      newDatum: makeInlineTxOutputDatum(VOID_DATA),
      deployedScripts: deployedScripts as never,
      refSpendSettingsAssetTxInput: settingsTxInput as never,
    });
    expect(missingAsset.ok).toBe(false);

    const success = await update({
      isMainnet: false,
      assetUtf8Name: "hal-1",
      refTxInput: refTxInput as never,
      newDatum: makeInlineTxOutputDatum(VOID_DATA),
      deployedScripts: deployedScripts as never,
      refSpendSettingsAssetTxInput: settingsTxInput as never,
    });
    expect(success.ok).toBe(true);
    expect(txBuilder.withdrawUnsafe).toHaveBeenCalled();
    expect(txBuilder.payUnsafe).toHaveBeenCalled();
  });

  test("royalty tx builders cover mint, missing-token, and update paths", async () => {
    vi.resetModules();
    const txBuilder = makeMockTxBuilder();
    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return { ...original, makeTxBuilder: vi.fn(() => txBuilder) };
    });

    const policyId = "8".repeat(56);
    const decodeSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeSettingsV1Data = vi.fn(() => ({
      allowed_minter: "9".repeat(56),
      policy_id: policyId,
      royalty_spend_script_hash: "a".repeat(56),
    }));
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        buildMintMintRoyaltyNFTRedeemer: vi.fn(() => VOID_DATA),
        buildRoyaltyDatumData: vi.fn(() => VOID_DATA),
        decodeSettingsDatum,
        decodeSettingsV1Data,
        makeVoidData: vi.fn(() => VOID_DATA),
      };
    });

    const { mintRoyalty, updateRoyalty } = await import("../src/txs/royalty.js");
    const scriptTxInput = makeTxInput();
    const deployedScripts = {
      mintProxyScriptTxInput: scriptTxInput,
      mintScriptDetails: { validatorHash: "b".repeat(56) },
      mintScriptTxInput: scriptTxInput,
      royaltySpendScriptTxInput: scriptTxInput,
    };
    const royaltyDatum = { extra: VOID_DATA, recipients: [], version: 0 };

    const mintResult = await mintRoyalty({
      isMainnet: false,
      royaltyDatum: royaltyDatum as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: scriptTxInput as never,
    });
    expect(mintResult.ok).toBe(true);
    expect(txBuilder.mintPolicyTokensUnsafe).toHaveBeenCalled();

    const missingToken = await updateRoyalty({
      isMainnet: false,
      royaltyTxInput: scriptTxInput as never,
      newRoyaltyDatum: royaltyDatum as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: scriptTxInput as never,
      royaltySpendAdmin: "c".repeat(56),
    });
    expect(missingToken.ok).toBe(false);

    const royaltyAsset = makeAssets([
      [makeAssetClass(`${policyId}.001f4d70526f79616c7479`), 1n],
    ]);
    const royaltyTxInput = makeTxInput(undefined, makeValue(1n, royaltyAsset));
    const updateResult = await updateRoyalty({
      isMainnet: false,
      royaltyTxInput: royaltyTxInput as never,
      newRoyaltyDatum: royaltyDatum as never,
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: scriptTxInput as never,
      royaltySpendAdmin: "c".repeat(56),
    });
    expect(updateResult.ok).toBe(true);
    expect(txBuilder.spendUnsafe).toHaveBeenCalledWith(royaltyTxInput, VOID_DATA);
  });

});
