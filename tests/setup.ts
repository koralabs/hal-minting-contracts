import {
  makeAssetClass,
  makeAssets,
  makeDummyAddress,
  makeInlineTxOutputDatum,
  makeMintingPolicyHash,
  makeTxOutput,
  makeTxOutputId,
  makeValidatorHash,
  makeValue,
  TxInput,
} from "@helios-lang/ledger";
import {
  BlockfrostV0Client,
  Emulator,
  makeEmulator,
  makeTxBuilder,
  NetworkName,
  SimpleWallet,
} from "@helios-lang/tx-utils";
import { decodeUplcProgramV2FromCbor, UplcProgramV2 } from "@helios-lang/uplc";
import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";
import fs from "fs/promises";
import { Ok } from "ts-res";
import { test, vi } from "vitest";

import {
  buildContracts,
  buildMintingData,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildSettingsData,
  buildSettingsV1Data,
  DeployedScripts,
  fillAssets,
  getWhitelistedKey,
  init,
  makeVoidData,
  makeWhitelistedValueData,
  MintingData,
  RefSpendSettings,
  RefSpendSettingsV1,
  RoyaltyDatum,
  Settings,
  SettingsV1,
  WhitelistedValue,
} from "../src/index.js";
import { extractScriptCborsFromUplcProgram } from "./utils.js";

const network: NetworkName = "preprod";
const isMainnet = false;
const ACCOUNT_LOVELACE = 5_000_000_000n;
const MIN_LOVELACE = 5_000_000n;

const dbPath = "./tests/test-db";
const whitelistDBPath = "./tests/whitelist-test-db";
const initialWhitelistDBPath = "./tests/initial-whitelist-test-db";

const settingsAssetClass = makeAssetClass(
  "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.000de14068616c4068616e646c655f73657474696e6773"
);
const refSpendSettingsAssetClass = makeAssetClass(
  "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.000de14068616c5f707a4068616e646c655f73657474696e6773"
);
const mintingDataAssetClass = makeAssetClass(
  "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.000de14068616c5f726f6f744068616e646c655f73657474696e6773"
);

const HAL_NFT_PRICE = 180_000_000n;

const GRACE_PERIOD = 60 * 1000; // 1 min

const deployScript = async (
  scriptType: ScriptType,
  emulator: Emulator,
  wallet: SimpleWallet,
  cbor: string,
  unoptimizedCbor: string
): Promise<[ScriptDetails, TxInput]> => {
  const txBuilder = makeTxBuilder({ isMainnet });
  const uplcProgram = decodeUplcProgramV2FromCbor(cbor);
  const output = makeTxOutput(
    makeDummyAddress(isMainnet),
    makeValue(1n),
    undefined,
    uplcProgram
  );
  output.correctLovelace(emulator.parametersSync);
  txBuilder.addOutput(output);
  const tx = await txBuilder.build({
    changeAddress: wallet.address,
    spareUtxos: await wallet.utxos,
  });
  tx.addSignatures(await wallet.signTx(tx));
  const txId = await wallet.submitTx(tx);
  emulator.tick(200);

  const refTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
  refTxInput.output.refScript = (
    refTxInput.output.refScript! as UplcProgramV2
  ).withAlt(decodeUplcProgramV2FromCbor(unoptimizedCbor));
  const scriptDetails: ScriptDetails = {
    handle: "",
    handleHex: "",
    type: scriptType,
    validatorHash: makeValidatorHash(uplcProgram.hash()).toHex(),
    refScriptUtxo: `${txId.toHex()}#0`,
  };

  return [scriptDetails, refTxInput];
};

const setup = async () => {
  const emulator = makeEmulator();

  const legacyPolicyId = makeMintingPolicyHash(
    "f060f0ef7fa4c3c6d3a4f831c639038db0f625c548a711f2b276a282"
  ).toHex();

  // ============ prepare wallets ============
  // fund wallet
  const fundWallet = emulator.createWallet(
    ACCOUNT_LOVELACE * 100n,
    makeAssets([
      [settingsAssetClass, 1n],
      [refSpendSettingsAssetClass, 1n],
      [mintingDataAssetClass, 1n],
    ])
  );
  emulator.tick(200);

  // admin wallet will keep settings asset
  const adminWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // allowed minter wallet
  const allowedMinterWallet: SimpleWallet = emulator.createWallet(5_000_000n);
  emulator.tick(200);
  const allowedMinterPubKeyHash: string =
    allowedMinterWallet.spendingPubKeyHash.toHex();

  // ref spend admin wallet
  const refSpendAdminWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // royalty spend admin wallet
  const royaltySpendAdminWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // payment wallet
  const paymentWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // users wallet
  const usersWallets: SimpleWallet[] = [];
  for (let i = 0; i < 5; i++) {
    usersWallets.push(emulator.createWallet(ACCOUNT_LOVELACE));
    emulator.tick(200);
  }

  // whitelisted users are user_4 and user_5
  const mintingStartTime = new Date("2025-07-01").valueOf();
  const twoHoursInMilliseconds = 1000 * 60 * 60 * 2; // 2 hours early
  const oneHourInMilliseconds = 1000 * 60 * 60; // 1 hour early
  const whitelistedPrice1: bigint = 150_000_000n;
  const whitelistedPrice2: bigint = 160_000_000n;
  const user4Wallet = usersWallets[3];
  const user5Wallet = usersWallets[4];

  // special users wallet (all whitelisted)
  const specialUsersWallets: SimpleWallet[] = [];
  for (let i = 0; i < 10; i++) {
    specialUsersWallets.push(emulator.createWallet(ACCOUNT_LOVELACE));
    emulator.tick(200);
  }

  // ============ build merkle trie db ============
  await fs.rm(dbPath, { recursive: true, force: true });
  const db = await init(dbPath);
  await fs.rm(whitelistDBPath, { recursive: true, force: true });
  const whitelistDB = await init(whitelistDBPath);
  await fs.rm(initialWhitelistDBPath, { recursive: true, force: true });
  const initialWhitelistDB = await init(initialWhitelistDBPath);

  // ============ build contracts ============
  const mintVersion = 0n;
  const adminPubKeyHash = adminWallet.spendingPubKeyHash.toHex();
  const royaltySpendAdminPubKeyHash =
    royaltySpendAdminWallet.spendingPubKeyHash.toHex();
  const contractsConfig = buildContracts({
    isMainnet,
    mint_version: mintVersion,
    admin_verification_key_hash: adminPubKeyHash,
    orders_spend_randomizer: "",
    royalty_spend_admin: royaltySpendAdminPubKeyHash,
  });
  const {
    halPolicyHash,
    mintProxy: mintProxyConfig,
    mint: mintConfig,
    mintingData: mintingDataConfig,
    ordersSpend: ordersSpendConfig,
    refSpendProxy: refSpendProxyConfig,
    refSpend: refSpendConfig,
    royaltySpend: royaltySpendConfig,
  } = contractsConfig;

  // ============ prepare settings data ============
  const settingsV1: SettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    allowed_minter: allowedMinterPubKeyHash,
    hal_nft_price: HAL_NFT_PRICE,
    minting_data_script_hash:
      mintingDataConfig.mintingDataValidatorHash.toHex(),
    orders_spend_script_hash:
      ordersSpendConfig.ordersSpendValidatorHash.toHex(),
    ref_spend_proxy_script_hash:
      refSpendProxyConfig.refSpendProxyValidatorHash.toHex(),
    ref_spend_governor: refSpendConfig.refSpendValidatorHash.toHex(),
    ref_spend_admin: refSpendAdminWallet.spendingPubKeyHash.toHex(),
    royalty_spend_script_hash:
      royaltySpendConfig.royaltySpendValidatorHash.toHex(),
    minting_start_time: mintingStartTime,
    payment_address: paymentWallet.address,
  };
  const settings: Settings = {
    mint_governor: mintConfig.mintValidatorHash.toHex(),
    mint_version: mintVersion,
    data: buildSettingsV1Data(settingsV1),
  };
  const refSpendSettingsV1: RefSpendSettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    ref_spend_admin: refSpendAdminWallet.spendingPubKeyHash.toHex(),
  };
  const refSpendSettings: RefSpendSettings = {
    ref_spend_governor: refSpendConfig.refSpendValidatorHash.toHex(),
    data: buildRefSpendSettingsV1Data(refSpendSettingsV1),
  };

  // prepare db
  // insert 10,000 hal assets names
  // with empty string value
  console.log("======= Starting Pre Filling DB =======\n");
  const assetNames = Array.from({ length: 1000 }, (_, i) => `hal-${i + 1}`);
  await fillAssets(db, assetNames, () => {});
  console.log("======= DB Pre Filled =======\n");
  console.log("DB Root Hash:\n", db.hash?.toString("hex"));
  console.log("===========================\n");

  // prepare whitelist db
  console.log("======= Starting Prepareing Whitelist DB =======\n");
  const whitelistedValue1: WhitelistedValue = [
    { time_gap: twoHoursInMilliseconds, amount: 10, price: whitelistedPrice1 },
    { time_gap: oneHourInMilliseconds, amount: 5, price: whitelistedPrice2 },
  ];
  const whitelistedValue2: WhitelistedValue = [
    { time_gap: oneHourInMilliseconds, amount: 10, price: whitelistedPrice2 },
  ];
  for (let i = 0; i < 2; i++) {
    const db = i === 0 ? initialWhitelistDB : whitelistDB;
    await db.insert(
      getWhitelistedKey(user4Wallet.address),
      Buffer.from(makeWhitelistedValueData(whitelistedValue1).toCbor())
    );
    await db.insert(
      getWhitelistedKey(user5Wallet.address),
      Buffer.from(makeWhitelistedValueData(whitelistedValue2).toCbor())
    );

    for (const specialWallet of specialUsersWallets) {
      await db.insert(
        getWhitelistedKey(specialWallet.address),
        Buffer.from(
          makeWhitelistedValueData([
            {
              time_gap: twoHoursInMilliseconds,
              amount: 2,
              price: whitelistedPrice1,
            },
            {
              time_gap: oneHourInMilliseconds,
              amount: 1,
              price: whitelistedPrice2,
            },
          ]).toCbor()
        )
      );
    }
  }
  console.log("======= Whitelist DB Pre Filled =======\n");
  console.log("Whitelist DB Root Hash:\n", whitelistDB.hash?.toString("hex"));
  console.log("===========================\n");

  // ============ prepare minting data ============
  const mintingData: MintingData = {
    mpt_root_hash: db.hash?.toString("hex"),
    whitelist_mpt_root_hash: whitelistDB.hash?.toString("hex"),
  };

  // ============ prepare settings and minting data asset ============
  const prepareAssetsTxBuilder = makeTxBuilder({ isMainnet });
  const fundWalletUTxOs = await fundWallet.utxos;
  prepareAssetsTxBuilder.spendUnsafe(fundWalletUTxOs);
  prepareAssetsTxBuilder.payUnsafe(
    adminWallet.address,
    makeValue(MIN_LOVELACE, makeAssets([[settingsAssetClass, 1n]])),
    makeInlineTxOutputDatum(buildSettingsData(settings))
  );
  prepareAssetsTxBuilder.payUnsafe(
    adminWallet.address,
    makeValue(MIN_LOVELACE, makeAssets([[refSpendSettingsAssetClass, 1n]])),
    makeInlineTxOutputDatum(buildRefSpendSettingsData(refSpendSettings))
  );
  prepareAssetsTxBuilder.payUnsafe(
    mintingDataConfig.mintingDataValidatorAddress,
    makeValue(MIN_LOVELACE, makeAssets([[mintingDataAssetClass, 1n]])),
    makeInlineTxOutputDatum(buildMintingData(mintingData))
  );
  const prepareAssetsTx = await prepareAssetsTxBuilder.build({
    changeAddress: fundWallet.address,
  });
  prepareAssetsTx.addSignatures(await fundWallet.signTx(prepareAssetsTx));
  const prepareAssetsTxId = await fundWallet.submitTx(prepareAssetsTx);
  emulator.tick(200);
  const settingsAssetTxInput = await emulator.getUtxo(
    makeTxOutputId(prepareAssetsTxId, 0)
  );
  const refSpendSettingsAssetTxInput = await emulator.getUtxo(
    makeTxOutputId(prepareAssetsTxId, 1)
  );
  const mintingDataAssetTxInput = await emulator.getUtxo(
    makeTxOutputId(prepareAssetsTxId, 2)
  );

  // ============ Deploy Scripts ============
  const [mintProxyScriptDetails, mintProxyScriptTxInput] = await deployScript(
    ScriptType.HAL_MINT_PROXY,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(
      mintProxyConfig.mintProxyMintUplcProgram
    )
  );
  const [mintScriptDetails, mintScriptTxInput] = await deployScript(
    ScriptType.HAL_MINT,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(mintConfig.mintWithdrawUplcProgram)
  );
  const [mintingDataScriptDetails, mintingDataScriptTxInput] =
    await deployScript(
      ScriptType.HAL_MINTING_DATA,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        mintingDataConfig.mintingDataSpendUplcProgram
      )
    );
  const [ordersSpendScriptDetails, ordersSpendScriptTxInput] =
    await deployScript(
      ScriptType.HAL_ORDERS_SPEND,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        ordersSpendConfig.ordersSpendUplcProgram
      )
    );
  const [refSpendProxyScriptDetails, refSpendProxyScriptTxInput] =
    await deployScript(
      ScriptType.HAL_REF_SPEND_PROXY,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        refSpendProxyConfig.refSpendProxyUplcProgram
      )
    );
  const [refSpendScriptDetails, refSpendScriptTxInput] = await deployScript(
    ScriptType.HAL_REF_SPEND,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(refSpendConfig.refSpendUplcProgram)
  );
  const [royaltySpendScriptDetails, royaltySpendScriptTxInput] =
    await deployScript(
      ScriptType.HAL_ROYALTY_SPEND,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        royaltySpendConfig.royaltySpendUplcProgram
      )
    );

  // ============ mock modules ============
  // mock constants
  vi.doMock("../src/constants/index.js", async (importOriginal) => {
    const defaultValues = await importOriginal<
      typeof import("../src/constants/index.js")
    >();
    return {
      ...defaultValues,
      LEGACY_POLICY_ID: legacyPolicyId,
    };
  });

  const deployedScripts: DeployedScripts = {
    mintProxyScriptDetails,
    mintProxyScriptTxInput,
    mintScriptDetails,
    mintScriptTxInput,
    mintingDataScriptDetails,
    mintingDataScriptTxInput,
    ordersSpendScriptDetails,
    ordersSpendScriptTxInput,
    refSpendProxyScriptDetails,
    refSpendProxyScriptTxInput,
    refSpendScriptDetails,
    refSpendScriptTxInput,
    royaltySpendScriptDetails,
    royaltySpendScriptTxInput,
  };

  // hoist mocked functions
  const {
    mockedFetchAllDeployedScripts,
    mockedFetchSettings,
    mockedFetchRefSpendSettings,
    mockedFetchMintingData,
    mockedGetBlockfrostV0Client,
    mockedGetNetwork,
  } = vi.hoisted(() => {
    return {
      mockedFetchAllDeployedScripts: vi.fn(),
      mockedFetchSettings: vi.fn(),
      mockedFetchRefSpendSettings: vi.fn(),
      mockedFetchMintingData: vi.fn(),
      mockedGetBlockfrostV0Client: vi.fn(),
      mockedGetNetwork: vi.fn(),
    };
  });

  // mock fetchAllDeployedScripts
  vi.mock("../src/txs/deploy.ts", () => {
    return { fetchAllDeployedScripts: mockedFetchAllDeployedScripts };
  });
  mockedFetchAllDeployedScripts.mockReturnValue(
    new Promise((resolve) => resolve(Ok(deployedScripts)))
  );

  // mock fetchSettings and fetchMintingData
  vi.mock("../src/configs/index.js", () => {
    return {
      fetchSettings: mockedFetchSettings,
      fetchRefSpendSettings: mockedFetchRefSpendSettings,
      fetchMintingData: mockedFetchMintingData,
    };
  });
  mockedFetchSettings.mockReturnValue(
    new Promise((resolve) =>
      resolve(Ok({ settings, settingsV1: settingsV1, settingsAssetTxInput }))
    )
  );
  mockedFetchRefSpendSettings.mockReturnValue(
    new Promise((resolve) =>
      resolve(
        Ok({
          refSpendSettings,
          refSpendSettingsV1,
          refSpendSettingsAssetTxInput,
        })
      )
    )
  );
  mockedFetchMintingData.mockReturnValue(
    new Promise((resolve) =>
      resolve(
        Ok({
          mintingData,
          mintingDataAssetTxInput,
        })
      )
    )
  );

  // mock getBlockfrostV0Client
  vi.mock("../src/helpers/blockfrost/client.ts", () => {
    return {
      getBlockfrostV0Client: mockedGetBlockfrostV0Client,
    };
  });
  mockedGetBlockfrostV0Client.mockReturnValue(
    new Promise((resolve) => resolve(emulator as unknown as BlockfrostV0Client))
  );

  // mock getNetwork
  vi.mock("../src/helpers/blockfrost/network.ts", () => {
    return { getNetwork: mockedGetNetwork };
  });
  mockedGetNetwork.mockReturnValue(network);

  const usedOrdersCount: Record<string, number> = {};

  // For royalty
  const dumbRoyaltyDatum: RoyaltyDatum = {
    recipients: [],
    version: 0,
    extra: makeVoidData(),
  };

  return {
    isMainnet,
    emulator,
    db,
    usedOrdersCount,
    initialWhitelistDB,
    whitelistDB,
    contractsConfig,
    allowedMinterPubKeyHash,
    legacyPolicyId,
    deployedScripts,
    maxOrderAmountInOneTx: 8,
    mockedFunctions: {
      mockedFetchAllDeployedScripts,
      mockedFetchSettings,
      mockedFetchRefSpendSettings,
      mockedFetchMintingData,
      mockedGetBlockfrostV0Client,
      mockedGetNetwork,
    },
    wallets: {
      fundWallet,
      adminWallet,
      allowedMinterWallet,
      refSpendAdminWallet,
      royaltySpendAdminWallet,
      paymentWallet,
      usersWallets,
      specialUsersWallets,
    },
    royalty: {
      dumbRoyaltyDatum,
      txInput: undefined as TxInput | undefined,
    },
    normalMintingTime: mintingStartTime + GRACE_PERIOD,
    whitelistMintingTimeTwoHoursEarly:
      mintingStartTime - twoHoursInMilliseconds + GRACE_PERIOD,
    whitelistMintingTimeOneHourEarly:
      mintingStartTime - oneHourInMilliseconds + GRACE_PERIOD,
    normalPrice: HAL_NFT_PRICE,
    whitelistedPrice1,
    whitelistedPrice2,
  };
};

const myTest = test.extend(await setup());

export { myTest };
