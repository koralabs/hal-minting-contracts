import {
  makeAddress,
  makeDummyAddress,
  makeInlineTxOutputDatum,
  makePubKeyHash,
  makeValidatorHash,
  makeValue,
} from "@helios-lang/ledger";
import {
  decodeUplcData,
  makeByteArrayData,
  makeConstrData,
} from "@helios-lang/uplc";
import fs from "fs/promises";
import { describe, expect, test, vi } from "vitest";

const VOID_DATA = decodeUplcData(Buffer.from("d87980", "hex"));

describe.sequential("Runtime Unit Coverage", () => {
  test("constants computes network host for mainnet and non-mainnet", async () => {
    const previousNetwork = process.env.NETWORK;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousEndpoint = process.env.HANDLE_API_ENDPOINT;
    process.env.NODE_ENV = "test";

    try {
      process.env.NETWORK = "mainnet";
      process.env.HANDLE_API_ENDPOINT = "";
      vi.resetModules();
      const constantsMainnet = await vi.importActual<
        typeof import("../src/constants/index.js")
      >("../src/constants/index.js");
      expect(constantsMainnet.NETWORK_HOST).toBe("");
      expect(constantsMainnet.HANDLE_API_ENDPOINT).toContain("api.handle.me");

      process.env.NETWORK = "preview";
      process.env.HANDLE_API_ENDPOINT = "https://custom.example";
      vi.resetModules();
      const constantsPreview = await vi.importActual<
        typeof import("../src/constants/index.js")
      >("../src/constants/index.js");
      expect(constantsPreview.NETWORK_HOST).toBe("preview.");
      expect(constantsPreview.HANDLE_API_ENDPOINT).toBe(
        "https://custom.example"
      );

      delete process.env.NODE_ENV;
      delete process.env.NETWORK;
      delete process.env.HANDLE_API_ENDPOINT;
      vi.resetModules();
      const constantsDefault = await vi.importActual<
        typeof import("../src/constants/index.js")
      >("../src/constants/index.js");
      expect(constantsDefault.NODE_ENV).toBe("");
      expect(constantsDefault.NETWORK_HOST).toBe("undefined.");
      expect(constantsDefault.HANDLE_API_ENDPOINT).toContain(
        "undefined.api.handle.me"
      );
    } finally {
      process.env.NETWORK = previousNetwork;
      process.env.HANDLE_API_ENDPOINT = previousEndpoint;
      process.env.NODE_ENV = previousNodeEnv;
      vi.resetModules();
    }
  });

  test("invariant supports default, string, and lazy messages", async () => {
    const { invariant } = await vi.importActual<
      typeof import("../src/helpers/common/invariant.js")
    >("../src/helpers/common/invariant.js");

    expect(() => invariant(true)).not.toThrow();
    expect(() => invariant(false)).toThrow("Invariant failed");
    expect(() => invariant(false, "x")).toThrow("Invariant failed: x");
    expect(() => invariant(false, () => "y")).toThrow("Invariant failed: y");
  });

  test("convertError handles unknown shapes", async () => {
    const convertError = (
      await vi.importActual<typeof import("../src/helpers/error/convert.js")>(
        "../src/helpers/error/convert.js"
      )
    ).default;

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(convertError(undefined)).toBe("undefined");
    expect(convertError(new Error("boom"))).toBe("boom");
    expect(convertError("plain")).toBe("plain");
    expect(convertError(cyclic)).toContain("self");
  });

  test("MPT proof parser handles branch/fork/leaf and errors", async () => {
    const { parseMPTProofJSON, parseMPTProofStepJSON } = await vi.importActual<
      typeof import("../src/contracts/types/mpt.js")
    >("../src/contracts/types/mpt.js");

    expect(
      parseMPTProofJSON([
        { type: "branch", skip: 1, neighbors: "aa" },
        { type: "fork", skip: 2, neighbor: { nibble: 1, prefix: "bb", root: "cc" } },
        { type: "leaf", skip: 3, neighbor: { key: "dd", value: "ee" } },
      ])
    ).toHaveLength(3);

    expect(() => parseMPTProofStepJSON({ type: "branch" } as never)).toThrow(
      "skip field is missing"
    );
    expect(() => parseMPTProofStepJSON({ skip: 0 } as never)).toThrow(
      "type field is missing"
    );
    expect(() =>
      parseMPTProofStepJSON({ type: "branch", skip: 0 } as never)
    ).toThrow("neighbors field is missing");
    expect(() =>
      parseMPTProofStepJSON({ type: "fork", skip: 0 } as never)
    ).toThrow("neighbor field is missing");
    expect(() =>
      parseMPTProofStepJSON({ type: "leaf", skip: 0 } as never)
    ).toThrow("neighbor field is missing");
    expect(() =>
      parseMPTProofStepJSON({ type: "unknown", skip: 0 } as never)
    ).toThrow("type is invalid");
  });

  test("common contract data helpers cover credential/staking/datum branches", async () => {
    const {
      buildAddressData,
      buildCredentialData,
      buildDatumData,
      buildingStakingCredentialData,
      decodeAddressFromData,
      decodeCredentialFromData,
      decodeDatumFromData,
      decodeStakingCredentialFromData,
      makeBoolData,
      makeOptionData,
      makeRedeemerWrapper,
      makeVoidData,
    } = await vi.importActual<typeof import("../src/contracts/data/common.js")>(
      "../src/contracts/data/common.js"
    );

    const pubKey = makePubKeyHash("1".repeat(56));
    const script = makeValidatorHash("2".repeat(56));
    const address = makeAddress(false, pubKey, pubKey);

    const pubKeyData = buildCredentialData(pubKey);
    const scriptData = buildCredentialData(script);
    expect(decodeCredentialFromData(pubKeyData).kind).toBe("PubKeyHash");
    expect(decodeCredentialFromData(scriptData).kind).toBe("ValidatorHash");
    expect(() =>
      decodeCredentialFromData(makeConstrData(9, [makeByteArrayData("aa")]))
    ).toThrow("Invalid Credential Constr Tag");

    const stakingSome = buildingStakingCredentialData(pubKey);
    const stakingNone = buildingStakingCredentialData(undefined);
    expect(decodeStakingCredentialFromData(stakingSome)?.kind).toBe(
      "PubKeyHash"
    );
    expect(decodeStakingCredentialFromData(stakingNone)).toBeUndefined();
    expect(() =>
      decodeStakingCredentialFromData(
        makeConstrData(0, [
          makeConstrData(0, [makeConstrData(9, [makeByteArrayData("aa")])]),
        ])
      )
    ).toThrow("Invalid Credential Constr Tag");

    const roundTripAddress = decodeAddressFromData(buildAddressData(address), false);
    expect(roundTripAddress.toBech32()).toBe(address.toBech32());

    expect(decodeDatumFromData(makeConstrData(0, []))).toBeUndefined();
    expect(
      decodeDatumFromData(makeConstrData(1, [makeByteArrayData("ab".repeat(32))]))
    ).toBeDefined();
    expect(
      decodeDatumFromData(
        makeConstrData(2, [makeConstrData(0, [makeByteArrayData("ff")])])
      )
    ).toBeDefined();
    expect(() => decodeDatumFromData(makeConstrData(3, []))).toThrow(
      "Invalid Datum Constr Tag"
    );

    expect(buildDatumData(undefined)).toBeDefined();
    expect(buildDatumData(makeInlineTxOutputDatum(makeVoidData()))).toBeDefined();
    expect(buildDatumData(decodeDatumFromData(makeConstrData(1, [makeByteArrayData("ab".repeat(32))])))).toBeDefined();
    expect(makeBoolData(true)).toBeDefined();
    expect(makeOptionData<string>(undefined, makeByteArrayData)).toBeDefined();
    expect(makeOptionData("ab", makeByteArrayData)).toBeDefined();
    expect(makeRedeemerWrapper(makeVoidData())).toBeDefined();
  });

  test("blockfrost network parser and client factory work for valid keys", async () => {
    const { getNetwork } = await vi.importActual<
      typeof import("../src/helpers/blockfrost/network.js")
    >("../src/helpers/blockfrost/network.js");
    const { getBlockfrostV0Client } = await vi.importActual<
      typeof import("../src/helpers/blockfrost/client.js")
    >("../src/helpers/blockfrost/client.js");

    expect(getNetwork("mainnetXYZ")).toBe("mainnet");
    expect(getNetwork("previewXYZ")).toBe("preview");
    expect(getNetwork("preprodXYZ")).toBe("preprod");
    expect(() => getNetwork("invalid")).toThrow("Unknown network invalid");

    const client = getBlockfrostV0Client("preview_test_key");
    expect(client).toBeDefined();
  });

  test("helper config supports get/has for strings and numbers", async () => {
    const { get, has } = await vi.importActual<
      typeof import("../src/helpers/config/index.js")
    >("../src/helpers/config/index.js");

    process.env.RUNTIME_TEST_STRING = "abc";
    process.env.RUNTIME_TEST_NUMBER = "42";
    delete process.env.RUNTIME_TEST_MISSING;

    expect(has("RUNTIME_TEST_STRING")).toBe(true);
    expect(get("RUNTIME_TEST_STRING", "string").ok).toBe(true);
    expect(get("RUNTIME_TEST_NUMBER", "number").ok).toBe(true);
    expect(get("RUNTIME_TEST_MISSING", "string").ok).toBe(false);
  });

  test("store and proof helpers execute success/error paths", async () => {
    const { buildProofs } = await vi.importActual<
      typeof import("../src/txs/proof.js")
    >("../src/txs/proof.js");
    const store = await vi.importActual<typeof import("../src/store/index.js")>(
      "../src/store/index.js"
    );

    const dbForProof = {
      get: vi.fn(async (key: string) => (key === "ok" ? "v" : undefined)),
      prove: vi.fn(async () => ({ toJSON: () => [{ type: "branch", skip: 0, neighbors: "aa" }] })),
      delete: vi.fn(async () => undefined),
      insert: vi.fn(async () => undefined),
    };

    const success = await buildProofs({
      orderedAssets: [
        {
          hexName: "6f6b",
          utf8Name: "ok",
          destinationAddress: makeDummyAddress(false),
          price: 1n,
        },
      ],
      db: dbForProof as never,
    });
    expect(success.ok).toBe(true);

    const failure = await buildProofs({
      orderedAssets: [
        {
          hexName: "6d697373",
          utf8Name: "miss",
          destinationAddress: makeDummyAddress(false),
          price: 1n,
        },
      ],
      db: dbForProof as never,
    });
    expect(failure.ok).toBe(false);

    const folder = "./tests/runtime-store-db";
    const trie = await store.init(folder);
    expect(trie).toBeDefined();
    await store.addAsset(trie, "k", "v");
    await store.removeAsset(trie, "k");
    await store.fillAssets(trie, ["a", "b"], () => {});
    const fakeDbForPrint = {
      prove: vi.fn(async () => ({
        toJSON: () => [{ ok: true }],
        toCBOR: () => Buffer.from("ab", "hex"),
      })),
    };
    await store.printProof(fakeDbForPrint as never, "a", "json");
    await store.printProof(fakeDbForPrint as never, "a", "cborHex");
    const removableFolder = "./tests/runtime-store-empty";
    await fs.mkdir(removableFolder, { recursive: true });
    await store.clear(removableFolder);
  });

  test("order request and validation cover key guard branches", async () => {
    vi.resetModules();
    const decodeOrderDatumData = vi
      .fn()
      .mockImplementation((_datum, _isMainnet) => ({ amount: 1 }));
    const decodeSettingsV1Data = vi
      .fn()
      .mockImplementation((_data, _isMainnet) => ({
        orders_spend_script_hash: "a".repeat(56),
        allowed_minter: "b".repeat(56),
      }));
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        buildOrderDatumData: vi.fn(() => VOID_DATA),
        decodeOrderDatumData,
        decodeSettingsV1Data,
      };
    });

    const orderModule = await import("../src/txs/order.js");
    const dummyAddress = makeDummyAddress(false);
    const validatorAddress = makeAddress(false, makeValidatorHash("a".repeat(56)));
    const settings = { data: VOID_DATA } as never;

    const invalidAmount = await orderModule.request({
      isMainnet: false,
      orders: [{ destinationAddress: dummyAddress, amount: 0, cost: 1n }],
      settings,
      maxOrderAmountInOneTx: 8,
    });
    expect(invalidAmount.ok).toBe(false);

    const tooLargeAmount = await orderModule.request({
      isMainnet: false,
      orders: [{ destinationAddress: dummyAddress, amount: 9, cost: 1n }],
      settings,
      maxOrderAmountInOneTx: 8,
    });
    expect(tooLargeAmount.ok).toBe(false);

    const invalidDestination = await orderModule.request({
      isMainnet: false,
      orders: [
        {
          destinationAddress: validatorAddress,
          amount: 1,
          cost: 1n,
        },
      ],
      settings,
      maxOrderAmountInOneTx: 8,
    });
    expect(invalidDestination.ok).toBe(false);

    const tooManyOrders = await orderModule.request({
      isMainnet: false,
      orders: Array.from({ length: 21 }, () => ({
        destinationAddress: dummyAddress,
        amount: 1,
        cost: 1n,
      })),
      settings,
      maxOrderAmountInOneTx: 8,
    });
    expect(tooManyOrders.ok).toBe(false);

    const validRequest = await orderModule.request({
      isMainnet: false,
      orders: [{ destinationAddress: dummyAddress, amount: 1, cost: 1n }],
      settings,
      maxOrderAmountInOneTx: 8,
    });
    expect(validRequest.ok).toBe(true);

    const validInput = {
      id: { toString: () => "tx#0" },
      address: validatorAddress,
      datum: VOID_DATA,
      value: makeValue(1n),
    };
    const valid = orderModule.isOrderTxInputValid({
      isMainnet: false,
      orderTxInput: validInput as never,
      settingsV1: { orders_spend_script_hash: "a".repeat(56) } as never,
      maxOrderAmountInOneTx: 8,
    });
    expect(valid.ok).toBe(true);

    const invalidAddressCheck = orderModule.isOrderTxInputValid({
      isMainnet: false,
      orderTxInput: { ...validInput, address: dummyAddress } as never,
      settingsV1: { orders_spend_script_hash: "a".repeat(56) } as never,
      maxOrderAmountInOneTx: 8,
    });
    expect(invalidAddressCheck.ok).toBe(false);

    decodeOrderDatumData.mockImplementationOnce(() => {
      throw new Error("bad datum");
    });
    const invalidDatum = orderModule.isOrderTxInputValid({
      isMainnet: false,
      orderTxInput: validInput as never,
      settingsV1: { orders_spend_script_hash: "a".repeat(56) } as never,
      maxOrderAmountInOneTx: 8,
    });
    expect(invalidDatum.ok).toBe(false);

    decodeOrderDatumData.mockImplementationOnce(() => ({ amount: 0 }));
    const zeroAmount = orderModule.isOrderTxInputValid({
      isMainnet: false,
      orderTxInput: validInput as never,
      settingsV1: { orders_spend_script_hash: "a".repeat(56) } as never,
      maxOrderAmountInOneTx: 8,
    });
    expect(zeroAmount.ok).toBe(false);

    decodeOrderDatumData.mockImplementationOnce(() => ({ amount: 9 }));
    const tooMuchOrder = orderModule.isOrderTxInputValid({
      isMainnet: false,
      orderTxInput: validInput as never,
      settingsV1: { orders_spend_script_hash: "a".repeat(56) } as never,
      maxOrderAmountInOneTx: 8,
    });
    expect(tooMuchOrder.ok).toBe(false);

    const byronAddress = {
      era: "Byron",
      spendingCredential: { kind: "PubKeyHash", toHex: () => "a".repeat(56) },
    };
    const cancelByron = await orderModule.cancel({
      isMainnet: false,
      address: byronAddress as never,
      orderTxInput: validInput as never,
      deployedScripts: {
        ordersSpendScriptTxInput: validInput,
        ordersSpendScriptDetails: { validatorHash: "a".repeat(56) },
      } as never,
    });
    expect(cancelByron.ok).toBe(false);

    const refundWrongAddress = await orderModule.refund({
      isMainnet: false,
      orderTxInput: { ...validInput, address: dummyAddress } as never,
      refundingAddress: dummyAddress as never,
      deployedScripts: {
        ordersSpendScriptTxInput: validInput,
        ordersSpendScriptDetails: { validatorHash: "a".repeat(56) },
      } as never,
      settingsAssetTxInput: validInput as never,
    });
    expect(refundWrongAddress.ok).toBe(false);

    const fetchOrderSuccess = await orderModule.fetchOrderTxInputs({
      cardanoClient: {
        isMainnet: () => false,
        getUtxos: async () => [validInput],
      } as never,
      ordersSpendScriptDetails: { validatorHash: "a".repeat(56) } as never,
    });
    expect(fetchOrderSuccess.ok).toBe(true);

    const fetchOrderFailure = await orderModule.fetchOrderTxInputs({
      cardanoClient: {
        isMainnet: () => false,
        getUtxos: async () => {
          throw new Error("boom");
        },
      } as never,
      ordersSpendScriptDetails: { validatorHash: "a".repeat(56) } as never,
    });
    expect(fetchOrderFailure.ok).toBe(false);
  });

  test("deploy and configs modules execute real success/error paths", async () => {
    vi.resetModules();

    const datum = VOID_DATA;
    const fakeScriptAddress = makeDummyAddress(false);
    const fakeHash = { toHex: () => "ab".repeat(28) };
    const fakeProgram = {
      toCbor: () => Buffer.from("4d01000033222220051200120011", "hex"),
      alt: {
        toCbor: () => Buffer.from("4d01000033222220051200120022", "hex"),
      },
    };

    const buildContracts = vi.fn(() => ({
      halPolicyHash: fakeHash,
      mintProxy: {
        mintProxyMintUplcProgram: fakeProgram,
        mintProxyPolicyHash: fakeHash,
      },
      mint: {
        mintWithdrawUplcProgram: fakeProgram,
        mintValidatorHash: fakeHash,
        mintStakingAddress: fakeScriptAddress,
      },
      mintingData: {
        mintingDataSpendUplcProgram: fakeProgram,
        mintingDataValidatorHash: fakeHash,
        mintingDataValidatorAddress: fakeScriptAddress,
      },
      ordersSpend: {
        ordersSpendUplcProgram: fakeProgram,
        ordersSpendValidatorHash: fakeHash,
        ordersSpendValidatorAddress: fakeScriptAddress,
      },
      refSpendProxy: {
        refSpendProxyUplcProgram: fakeProgram,
        refSpendProxyValidatorHash: fakeHash,
        refSpendProxyValidatorAddress: fakeScriptAddress,
      },
      refSpend: {
        refSpendUplcProgram: fakeProgram,
        refSpendValidatorHash: fakeHash,
        refSpendStakingAddress: fakeScriptAddress,
      },
      royaltySpend: {
        royaltySpendUplcProgram: fakeProgram,
        royaltySpendValidatorHash: fakeHash,
        royaltySpendValidatorAddress: fakeScriptAddress,
      },
    }));

    const fetchDeployedScript = vi.fn(async () => ({
      refScriptUtxo: "a".repeat(64) + "#0",
      unoptimizedCbor: "4d01000033222220051200120011",
    }));
    const decodeMintingDataDatum = vi.fn(() => ({ root: "ok" }));
    const decodeRefSpendSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeRefSpendSettingsV1Data = vi.fn(() => ({
      policy_id: "ab".repeat(28),
      ref_spend_admin: "a".repeat(56),
    }));
    const decodeSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeSettingsV1Data = vi.fn(() => ({
      policy_id: "ab".repeat(28),
      allowed_minter: "a".repeat(56),
      orders_spend_script_hash: "a".repeat(56),
      ref_spend_proxy_script_hash: "b".repeat(56),
      royalty_spend_script_hash: "c".repeat(56),
      minting_start_time: Date.now(),
      hal_nft_price: 1n,
    }));
    const fetchApi = vi.fn().mockImplementation(async (endpoint: string) => {
      if (endpoint.includes("/datum")) {
        return { text: async () => "d87980" };
      }
      if (endpoint.endsWith("/utxo")) {
        return { json: async () => ({ lovelace: "1" }) };
      }
      return {
        json: async () => ({
          utxo: "a".repeat(64) + "#0",
          hex: "abcd",
          resolved_addresses: { ada: makeDummyAddress(false).toBech32() },
        }),
      };
    });

    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        buildContracts,
        decodeMintingDataDatum,
        decodeRefSpendSettingsDatum,
        decodeRefSpendSettingsV1Data,
        decodeSettingsDatum,
        decodeSettingsV1Data,
        makeMintProxyUplcProgramParameterDatum: vi.fn(() => ({ data: datum })),
        makeMintingDataUplcProgramParameterDatum: vi.fn(() => ({ data: datum })),
        makeOrdersSpendUplcProgramParameterDatum: vi.fn(() => ({ data: datum })),
        makeRoyaltySpendUplcProgramParameterDatum: vi.fn(() => ({ data: datum })),
      };
    });

    vi.doMock("../src/utils/contract.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/utils/contract.js")>();
      return { ...original, fetchDeployedScript };
    });

    vi.doMock("../src/helpers/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/helpers/index.js")>();
      return {
        ...original,
        fetchApi,
      };
    });
    vi.doMock("@helios-lang/uplc", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/uplc")>();
      return {
        ...original,
        decodeUplcProgramV2FromCbor: vi.fn(() => fakeProgram),
      };
    });

    const deployModule = await vi.importActual<
      typeof import("../src/txs/deploy.js")
    >("../src/txs/deploy.js");
    const configsModule = await vi.importActual<
      typeof import("../src/configs/index.js")
    >("../src/configs/index.js");
    const constants = await vi.importActual<typeof import("../src/constants/index.js")>(
      "../src/constants/index.js"
    );

    for (const contractName of Object.values(constants.CONTRACT_NAME)) {
      const deployResult = await deployModule.deploy({
        isMainnet: false,
        mintVersion: 0n,
        adminVerificationKeyHash: "b".repeat(56),
        royaltySpendAdmin: "c".repeat(56),
        contractName,
      });
      expect(deployResult.optimizedCbor.length).toBeGreaterThan(0);
    }
    await expect(
      deployModule.deploy({
        isMainnet: false,
        mintVersion: 0n,
        adminVerificationKeyHash: "b".repeat(56),
        royaltySpendAdmin: "c".repeat(56),
        contractName: "unknown.contract" as never,
      })
    ).rejects.toThrow("Contract name must be one of");

    const deployedScriptsResult = await deployModule.fetchAllDeployedScripts({
      getUtxo: vi.fn(async () => ({
        output: {
          refScript: {
            withAlt: vi.fn(() => fakeProgram),
          },
        },
      })),
    } as never);
    expect(deployedScriptsResult.ok).toBe(true);

    const settingsResult = await configsModule.fetchSettings(false);
    const refSpendResult = await configsModule.fetchRefSpendSettings();
    const mintingDataResult = await configsModule.fetchMintingData();
    expect(settingsResult.ok).toBe(true);
    expect(refSpendResult.ok).toBe(true);
    expect(mintingDataResult.ok).toBe(true);

    decodeSettingsDatum.mockImplementationOnce(() => {
      throw new Error("bad settings");
    });
    const invalidSettings = await configsModule.fetchSettings(false);
    expect(invalidSettings.ok).toBe(false);

    decodeRefSpendSettingsDatum.mockImplementationOnce(() => {
      throw new Error("bad ref spend");
    });
    const invalidRefSpend = await configsModule.fetchRefSpendSettings();
    expect(invalidRefSpend.ok).toBe(false);

    decodeMintingDataDatum.mockImplementationOnce(() => {
      throw new Error("bad minting data");
    });
    const invalidMintingData = await configsModule.fetchMintingData();
    expect(invalidMintingData.ok).toBe(false);

    fetchApi
      .mockImplementationOnce(async () => ({
        json: async () => ({
          utxo: "a".repeat(64) + "#0",
          hex: "abcd",
          resolved_addresses: { ada: makeDummyAddress(false).toBech32() },
        }),
      }))
      .mockImplementationOnce(async () => ({ text: async () => "" }));
    await expect(configsModule.fetchSettings(false)).rejects.toThrow(
      "Settings Datum Not Found"
    );

    fetchDeployedScript.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const deployFailure = await deployModule.fetchAllDeployedScripts({
      getUtxo: vi.fn(async () => ({
        output: { refScript: { withAlt: vi.fn(() => fakeProgram) } },
      })),
    } as never);
    expect(deployFailure.ok).toBe(false);
  });

  test("whitelist helpers cover branches and error handling", async () => {
    vi.resetModules();
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeWhitelistedValueFromCBOR: vi.fn(() => ({ ok: false, error: "bad" })),
      };
    });
    const whitelist = await import("../src/txs/whitelist.js");
    const address = makeDummyAddress(false);

    const noValue = await whitelist.getWhitelistedValue(
      { get: async () => undefined } as never,
      address
    );
    expect(noValue).toBeNull();

    const decodeFailure = await whitelist.getWhitelistedValue(
      { get: async () => Buffer.from("00", "hex") } as never,
      address
    );
    expect(decodeFailure).toBeNull();

    const thrown = await whitelist.getWhitelistedValue(
      {
        get: async () => {
          throw new Error("db failure");
        },
      } as never,
      address
    );
    expect(thrown).toBeNull();

    const value = [
      { time_gap: 1000, amount: 2, price: 10n },
      { time_gap: 10, amount: 1, price: 20n },
      { time_gap: 1, amount: 0, price: 30n },
    ];
    const updated = whitelist.updateWhitelistedValue(value, 3, 5);
    expect(updated.remainingOrderedAmount).toBe(0);
    expect(updated.spentLovelaceForWhitelisted).toBe(40n);

    const updatedLate = whitelist.updateWhitelistedValue(value, 2, 2_000);
    expect(updatedLate.remainingOrderedAmount).toBe(2);

    const possible = whitelist.useWhitelistedValueAsPossible(value, 2);
    expect(possible.remainingOrderedAmount).toBe(0);
    expect(possible.spentLovelaceForWhitelisted).toBe(20n);

    const available = whitelist.getAvailableWhitelistedValue(value, 50);
    expect(available).toHaveLength(1);
    expect(whitelist.getWhitelistedKey(address)).toBeInstanceOf(Buffer);
  });

  test("helpers and utility modules execute standard paths", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ ok: true }),
    }));

    vi.doMock("cross-fetch", () => ({
      fetch: fetchMock,
    }));
    const previousApiEndpoint = process.env.HANDLE_API_ENDPOINT;
    const previousApiKey = process.env.HANDLE_ME_API_KEY;
    const previousUa = process.env.KORA_USER_AGENT;
    process.env.HANDLE_API_ENDPOINT = "https://api.example";
    process.env.HANDLE_ME_API_KEY = "api-key";
    process.env.KORA_USER_AGENT = "ua";

    const { fetchApi } = await import("../src/helpers/api.js");
    await fetchApi("health", { headers: { "x-id": "1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-id": "1",
          "User-Agent": "ua",
          "api-key": "api-key",
        }),
      })
    );
    process.env.HANDLE_API_ENDPOINT = previousApiEndpoint;
    process.env.HANDLE_ME_API_KEY = previousApiKey;
    process.env.KORA_USER_AGENT = previousUa;

    const { fetchDeployedScript } = await import("../src/utils/contract.js");
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ validatorHash: "ok" }),
    });
    const script = await fetchDeployedScript("HAL_MINT" as never);
    expect(script).toBeDefined();

    fetchMock.mockResolvedValueOnce({
      json: async () => null,
    });
    await fetchDeployedScript("HAL_MINT" as never).catch(() => undefined);

    const { minBigInt, maxBigInt } = await import("../src/utils/math.js");
    expect(minBigInt(3n, 2n, 9n)).toBe(2n);
    expect(maxBigInt(3n, 2n, 9n)).toBe(9n);
    expect(() => minBigInt()).toThrow("At least one value must be provided");
    expect(() => maxBigInt()).toThrow("At least one value must be provided");

    const contractUtils = await import("../src/contracts/utils.js");
    expect(contractUtils.makeMintProxyUplcProgramParameter(1n)).toHaveLength(1);
    expect(
      contractUtils.makeMintProxyUplcProgramParameterDatum(1n).kind
    ).toBe("InlineTxOutputDatum");
    expect(
      contractUtils.makeMintingDataUplcProgramParameter("aa")
    ).toHaveLength(1);
    expect(
      contractUtils.makeMintingDataUplcProgramParameterDatum("aa").kind
    ).toBe("InlineTxOutputDatum");
    expect(
      contractUtils.makeOrdersSpendUplcProgramParameter("aa", "bb")
    ).toHaveLength(2);
    expect(
      contractUtils.makeOrdersSpendUplcProgramParameterDatum("aa", "bb").kind
    ).toBe("InlineTxOutputDatum");
    expect(
      contractUtils.makeRoyaltySpendUplcProgramParameter("aa")
    ).toHaveLength(1);
    expect(
      contractUtils.makeRoyaltySpendUplcProgramParameterDatum("aa").kind
    ).toBe("InlineTxOutputDatum");
  });

  test("staking registration builder runs through all operations", async () => {
    vi.resetModules();
    const addDCert = vi.fn();
    const build = vi.fn(async () => ({
      toCbor: () => Buffer.from("aa", "hex"),
    }));
    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return {
        ...original,
        makeTxBuilder: vi.fn(() => ({
          addDCert,
          build,
        })),
      };
    });
    vi.doMock("@helios-lang/ledger", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/ledger")>();
      return {
        ...original,
        makeRegistrationDCert: vi.fn(() => ({ cert: true })),
        parseStakingAddress: vi.fn(() => ({ stakingCredential: { key: "x" } })),
      };
    });

    const { registerStakingAddresses } = await import("../src/txs/staking.js");
    const txCbor = await registerStakingAddresses(
      "preview",
      makeDummyAddress(false),
      [],
      ["stake_test_1", "stake_test_2"]
    );
    expect(txCbor).toBe("aa");
    expect(addDCert).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenCalledOnce();
  });

  test("ref spend and royalty return expected guard errors", async () => {
    vi.resetModules();
    const makeTxBuilder = vi.fn(() => ({
      refer: vi.fn(),
      withdrawUnsafe: vi.fn(),
      addSigners: vi.fn(),
      spendUnsafe: vi.fn(),
      payUnsafe: vi.fn(),
      mintPolicyTokensUnsafe: vi.fn(),
    }));
    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return {
        ...original,
        makeTxBuilder,
      };
    });
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeRefSpendSettingsDatum: vi.fn(() => {
          throw new Error("invalid settings");
        }),
        decodeSettingsDatum: vi.fn(() => {
          throw new Error("invalid settings");
        }),
      };
    });
    const { update } = await import("../src/txs/ref_spend.js");
    const { updateRoyalty } = await import("../src/txs/royalty.js");

    const baseAddress = makeDummyAddress(false);
    const txInput = {
      address: baseAddress,
      datum: VOID_DATA,
      value: makeValue(0n),
    };
    const deployedScripts = {
      refSpendProxyScriptTxInput: txInput,
      refSpendScriptTxInput: txInput,
      refSpendScriptDetails: { validatorHash: "a".repeat(56) },
      royaltySpendScriptTxInput: txInput,
    };

    const refSpendResult = await update({
      isMainnet: false,
      assetUtf8Name: "hal-1",
      refTxInput: txInput as never,
      newDatum: makeInlineTxOutputDatum(VOID_DATA),
      deployedScripts: deployedScripts as never,
      refSpendSettingsAssetTxInput: txInput as never,
    });
    expect(refSpendResult.ok).toBe(false);

    const royaltyResult = await updateRoyalty({
      isMainnet: false,
      royaltyTxInput: txInput as never,
      newRoyaltyDatum: { recipients: [], version: 0, extra: VOID_DATA },
      deployedScripts: deployedScripts as never,
      settingsAssetTxInput: txInput as never,
      royaltySpendAdmin: "a".repeat(56),
    });
    expect(royaltyResult.ok).toBe(false);

    vi.resetModules();
    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<typeof import("@helios-lang/tx-utils")>();
      return {
        ...original,
        makeTxBuilder,
      };
    });
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeRefSpendSettingsDatum: vi.fn(() => ({ data: VOID_DATA })),
        decodeRefSpendSettingsV1Data: vi.fn(() => ({
          policy_id: "a".repeat(56),
          ref_spend_admin: "a".repeat(56),
        })),
        decodeSettingsDatum: vi.fn(() => ({ data: VOID_DATA })),
        decodeSettingsV1Data: vi.fn(() => ({
          policy_id: "a".repeat(56),
          royalty_spend_script_hash: "b".repeat(56),
          allowed_minter: "c".repeat(56),
        })),
        buildMintMintRoyaltyNFTRedeemer: vi.fn(() => VOID_DATA),
        buildRoyaltyDatumData: vi.fn(() => VOID_DATA),
        makeVoidData: vi.fn(() => VOID_DATA),
      };
    });
    const refSpendModule = await import("../src/txs/ref_spend.js");
    const royaltyModule = await import("../src/txs/royalty.js");
    const successInput = {
      address: baseAddress,
      datum: VOID_DATA,
      value: {
        isGreaterOrEqual: () => true,
        assets: { hasAssetClass: () => true },
        lovelace: 1n,
      },
    };
    const successScripts = {
      refSpendProxyScriptTxInput: successInput,
      refSpendScriptTxInput: successInput,
      refSpendScriptDetails: { validatorHash: "a".repeat(56) },
      royaltySpendScriptTxInput: successInput,
      mintProxyScriptTxInput: successInput,
      mintScriptTxInput: successInput,
      mintScriptDetails: { validatorHash: "a".repeat(56) },
    };
    const refSpendSuccess = await refSpendModule.update({
      isMainnet: false,
      assetUtf8Name: "hal-1",
      refTxInput: successInput as never,
      newDatum: makeInlineTxOutputDatum(VOID_DATA),
      deployedScripts: successScripts as never,
      refSpendSettingsAssetTxInput: successInput as never,
    });
    expect(refSpendSuccess.ok).toBe(true);

    const mintRoyaltySuccess = await royaltyModule.mintRoyalty({
      isMainnet: false,
      royaltyDatum: { recipients: [], version: 0, extra: VOID_DATA },
      deployedScripts: successScripts as never,
      settingsAssetTxInput: successInput as never,
    });
    expect(mintRoyaltySuccess.ok).toBe(true);

    const updateRoyaltySuccess = await royaltyModule.updateRoyalty({
      isMainnet: false,
      royaltyTxInput: successInput as never,
      newRoyaltyDatum: { recipients: [], version: 0, extra: VOID_DATA },
      deployedScripts: successScripts as never,
      settingsAssetTxInput: successInput as never,
      royaltySpendAdmin: "a".repeat(56),
    });
    expect(updateRoyaltySuccess.ok).toBe(true);
  });

  test("prepare mint and rollback cover guard branches", async () => {
    vi.resetModules();

    const decodeSettingsDatum = vi.fn(() => ({ data: VOID_DATA }));
    const decodeSettingsV1Data = vi.fn(() => ({
      policy_id: "a".repeat(56),
      allowed_minter: "b".repeat(56),
      ref_spend_proxy_script_hash: "c".repeat(56),
      minting_start_time: 10_000,
    }));
    const decodeMintingDataDatum = vi.fn();
    const decodeWhitelistedValueFromCBOR = vi.fn(() => ({
      ok: true,
      data: [{ time_gap: 1, amount: 1, price: 1n }],
    }));

    vi.doMock("@helios-lang/tx-utils", async (importOriginal) => {
      const original = await importOriginal<
        typeof import("@helios-lang/tx-utils")
      >();
      return {
        ...original,
        makeTxBuilder: vi.fn(() => ({
          addSigners: vi.fn(),
          refer: vi.fn(),
          withdrawUnsafe: vi.fn(),
          validFromTime: vi.fn(),
          spendUnsafe: vi.fn(),
          payUnsafe: vi.fn(),
          mintPolicyTokensUnsafe: vi.fn(),
        })),
      };
    });

    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<
        typeof import("../src/contracts/index.js")
      >();
      return {
        ...original,
        buildMintingData: vi.fn(() => VOID_DATA),
        buildMintingDataMintRedeemer: vi.fn(() => VOID_DATA),
        buildMintMintNFTsRedeemer: vi.fn(() => VOID_DATA),
        buildOrdersSpendExecuteOrdersRedeemer: vi.fn(() => VOID_DATA),
        decodeMintingDataDatum,
        decodeSettingsDatum,
        decodeSettingsV1Data,
        decodeWhitelistedValueFromCBOR,
        makeWhitelistedItemData: vi.fn(() => ({
          toCbor: () => Buffer.from("d87980", "hex"),
        })),
        makeWhitelistedValueData: vi.fn(() => ({
          toCbor: () => Buffer.from("d87980", "hex"),
        })),
      };
    });

    const { prepareMintTransaction, rollBackOrdersFromTries } = await import(
      "../src/txs/prepareMint.js"
    );

    const destinationAddress = makeDummyAddress(false);
    const txInput = {
      id: { toString: () => "tx#0" },
      address: destinationAddress,
      datum: VOID_DATA,
      value: makeValue(1n),
    };

    const mkDb = (overrides: Record<string, unknown> = {}) => ({
      hash: Buffer.from("11".repeat(32), "hex"),
      get: vi.fn(async () => "v"),
      prove: vi.fn(async () => ({
        toJSON: () => [{ type: "branch", skip: 0, neighbors: "aa" }],
      })),
      delete: vi.fn(async () => undefined),
      insert: vi.fn(async () => undefined),
      ...overrides,
    });
    const mkWhitelistDb = (overrides: Record<string, unknown> = {}) => ({
      hash: Buffer.from("22".repeat(32), "hex"),
      get: vi.fn(async () => Buffer.from("d87980", "hex")),
      prove: vi.fn(async () => ({
        toJSON: () => [{ type: "branch", skip: 0, neighbors: "aa" }],
      })),
      delete: vi.fn(async () => undefined),
      insert: vi.fn(async () => undefined),
      ...overrides,
    });
    const rootHash = (hash: Buffer | undefined) =>
      (hash?.toString("hex") || Buffer.alloc(32).toString("hex")).toLowerCase();

    const mkParams = (overrides: Record<string, unknown> = {}) => {
      const db = (overrides.db as ReturnType<typeof mkDb>) ?? mkDb();
      const whitelistDB =
        (overrides.whitelistDB as ReturnType<typeof mkWhitelistDb>) ??
        mkWhitelistDb();

      return {
        isMainnet: false,
        address: destinationAddress,
        aggregatedOrders: [],
        assetsInfo: [],
        db,
        whitelistDB,
        deployedScripts: {
          mintProxyScriptTxInput: txInput,
          mintingDataScriptTxInput: txInput,
          mintScriptDetails: { validatorHash: "d".repeat(56) },
          mintScriptTxInput: txInput,
          ordersSpendScriptTxInput: txInput,
        },
        settingsAssetTxInput: txInput,
        mintingDataAssetTxInput: txInput,
        mintingTime: 1_000,
        ...overrides,
      };
    };

    let result = await prepareMintTransaction(
      mkParams({ address: { era: "Byron" } })
    );
    expect(result.ok).toBe(false);

    decodeSettingsDatum.mockImplementationOnce(() => {
      throw new Error("bad settings");
    });
    result = await prepareMintTransaction(mkParams());
    expect(result.ok).toBe(false);

    decodeSettingsV1Data.mockImplementationOnce(() => {
      throw new Error("bad settings v1");
    });
    result = await prepareMintTransaction(mkParams());
    expect(result.ok).toBe(false);

    decodeMintingDataDatum.mockImplementationOnce(() => {
      throw new Error("bad minting data");
    });
    result = await prepareMintTransaction(mkParams());
    expect(result.ok).toBe(false);

    const mismatchDb = mkDb();
    const mismatchWhitelistDb = mkWhitelistDb();
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: "ff".repeat(32),
      whitelist_mpt_root_hash: rootHash(mismatchWhitelistDb.hash),
    }));
    result = await prepareMintTransaction(
      mkParams({ db: mismatchDb, whitelistDB: mismatchWhitelistDb })
    );
    expect(result.ok).toBe(false);

    const mismatchWhitelistOnlyDb = mkDb();
    const mismatchWhitelistOnlyWhitelistDb = mkWhitelistDb();
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(mismatchWhitelistOnlyDb.hash),
      whitelist_mpt_root_hash: "ee".repeat(32),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: mismatchWhitelistOnlyDb,
        whitelistDB: mismatchWhitelistOnlyWhitelistDb,
      })
    );
    expect(result.ok).toBe(false);

    const missingAssetDb = mkDb();
    const missingAssetWhitelistDb = mkWhitelistDb();
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(missingAssetDb.hash),
      whitelist_mpt_root_hash: rootHash(missingAssetWhitelistDb.hash),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: missingAssetDb,
        whitelistDB: missingAssetWhitelistDb,
        aggregatedOrders: [
          {
            destinationAddress,
            amount: 1,
            orderTxInputs: [txInput],
            needWhitelistProof: false,
          },
        ],
        assetsInfo: [],
      })
    );
    expect(result.ok).toBe(false);

    const missingWhitelistDb = mkDb();
    const missingWhitelistValueDb = mkWhitelistDb({
      get: vi.fn(async () => undefined),
    });
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(missingWhitelistDb.hash),
      whitelist_mpt_root_hash: rootHash(missingWhitelistValueDb.hash),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: missingWhitelistDb,
        whitelistDB: missingWhitelistValueDb,
        aggregatedOrders: [
          {
            destinationAddress,
            amount: 1,
            orderTxInputs: [txInput],
            needWhitelistProof: true,
          },
        ],
        assetsInfo: [
          {
            assetUtf8Name: "hal-1",
            assetDatum: makeInlineTxOutputDatum(VOID_DATA),
          },
        ],
      })
    );
    expect(result.ok).toBe(false);

    const invalidWhitelistDecodeDb = mkDb();
    const invalidWhitelistDecodeWhitelistDb = mkWhitelistDb();
    decodeWhitelistedValueFromCBOR.mockReturnValueOnce({
      ok: false,
      error: "invalid whitelist cbor",
    });
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(invalidWhitelistDecodeDb.hash),
      whitelist_mpt_root_hash: rootHash(invalidWhitelistDecodeWhitelistDb.hash),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: invalidWhitelistDecodeDb,
        whitelistDB: invalidWhitelistDecodeWhitelistDb,
        aggregatedOrders: [
          {
            destinationAddress,
            amount: 1,
            orderTxInputs: [txInput],
            needWhitelistProof: true,
          },
        ],
        assetsInfo: [
          {
            assetUtf8Name: "hal-1",
            assetDatum: makeInlineTxOutputDatum(VOID_DATA),
          },
        ],
      })
    );
    expect(result.ok).toBe(false);

    const whitelistProofThrowsDb = mkDb();
    const whitelistProofThrowsWhitelistDb = mkWhitelistDb({
      prove: vi.fn(async () => {
        throw new Error("whitelist prove failure");
      }),
    });
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(whitelistProofThrowsDb.hash),
      whitelist_mpt_root_hash: rootHash(whitelistProofThrowsWhitelistDb.hash),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: whitelistProofThrowsDb,
        whitelistDB: whitelistProofThrowsWhitelistDb,
        aggregatedOrders: [
          {
            destinationAddress,
            amount: 1,
            orderTxInputs: [txInput],
            needWhitelistProof: true,
          },
        ],
        assetsInfo: [
          {
            assetUtf8Name: "hal-1",
            assetDatum: makeInlineTxOutputDatum(VOID_DATA),
          },
        ],
      })
    );
    expect(result.ok).toBe(false);

    const emptyHashDb = mkDb({ hash: undefined });
    const emptyHashWhitelistDb = mkWhitelistDb({ hash: undefined });
    decodeMintingDataDatum.mockImplementationOnce(() => ({
      mpt_root_hash: rootHash(undefined),
      whitelist_mpt_root_hash: rootHash(undefined),
    }));
    result = await prepareMintTransaction(
      mkParams({
        db: emptyHashDb,
        whitelistDB: emptyHashWhitelistDb,
      })
    );
    expect(result.ok).toBe(true);

    const rollbackError = await rollBackOrdersFromTries({
      utf8Names: ["hal-rollback"],
      whitelistedItemsData: [],
      db: {
        get: vi.fn(async () => {
          throw new Error("rollback db error");
        }),
        delete: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
      } as never,
      whitelistDB: {
        get: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
      } as never,
    });
    expect(rollbackError.ok).toBe(false);

    const rollbackWhitelist = {
      get: vi.fn(async () => Buffer.from("00", "hex")),
      delete: vi.fn(async () => undefined),
      insert: vi.fn(async () => undefined),
    };
    const rollbackOk = await rollBackOrdersFromTries({
      utf8Names: ["hal-unset"],
      whitelistedItemsData: [
        {
          address: destinationAddress,
          whitelistedItem: { time_gap: 1, amount: 1, price: 1n },
        },
      ],
      db: {
        get: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
      } as never,
      whitelistDB: rollbackWhitelist as never,
    });
    expect(rollbackOk.ok).toBe(true);
    expect(rollbackWhitelist.delete).toHaveBeenCalledTimes(1);
    expect(rollbackWhitelist.insert).toHaveBeenCalledTimes(1);
  });
});
