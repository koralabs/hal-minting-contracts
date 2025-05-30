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
  buildSettingsData,
  buildSettingsV1Data,
  DeployedScripts,
  fillAssets,
  init,
  MintingData,
  Settings,
  SettingsV1,
} from "../src/index.js";
import { extractScriptCborsFromUplcProgram } from "./utils.js";

const network: NetworkName = "preprod";
const isMainnet = false;
const ACCOUNT_LOVELACE = 5_000_000_000n;
const MIN_LOVELACE = 5_000_000n;

const dbPath = "./tests/test-db";

const settingsAssetClass = makeAssetClass(
  "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.000de14068616c4068616e646c655f73657474696e6773"
);
const mintingDataAssetClass = makeAssetClass(
  "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.000de14068616c5f726f6f744068616e646c655f73657474696e6773"
);

const HAL_NFT_PRICE = 180_000_000n;

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
    ACCOUNT_LOVELACE,
    makeAssets([
      [settingsAssetClass, 1n],
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

  // orders minter wallet
  const ordersMinterWallet: SimpleWallet =
    emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);
  const ordersMinterPubKeyHash: string =
    ordersMinterWallet.spendingPubKeyHash.toHex();

  // ref spend admin wallet
  const refSpendAdminWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // payment wallet
  const paymentWallet = emulator.createWallet(ACCOUNT_LOVELACE);
  emulator.tick(200);

  // order nfts collector
  const orderNftsCollectorWallet = emulator.createWallet(0n);
  emulator.tick(200);

  // users wallet
  const usersWallets: SimpleWallet[] = [];
  for (let i = 0; i < 5; i++) {
    usersWallets.push(emulator.createWallet(ACCOUNT_LOVELACE));
    emulator.tick(200);
  }

  // ============ build merkle trie db ============
  await fs.rm(dbPath, { recursive: true, force: true });
  const db = await init(dbPath);

  // ============ build contracts ============
  const mintVersion = 0n;
  const adminPubKeyHash = adminWallet.spendingPubKeyHash.toHex();
  const contractsConfig = buildContracts({
    network,
    mint_version: mintVersion,
    admin_verification_key_hash: adminPubKeyHash,
  });
  const {
    halPolicyHash,
    mintProxy: mintProxyConfig,
    mintV1: mintV1Config,
    mintingData: mintingDataConfig,
    ordersMint: ordersMintConfig,
    ordersSpend: ordersSpendConfig,
    refSpend: refSpendConfig,
  } = contractsConfig;

  // ============ prepare settings data ============
  const settingsV1: SettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    allowed_minter: allowedMinterPubKeyHash,
    hal_nft_price: HAL_NFT_PRICE,
    payment_address: paymentWallet.address,
    ref_spend_script_address: refSpendConfig.refSpendValidatorAddress,
    orders_spend_script_address: ordersSpendConfig.ordersSpendValidatorAddress,
    orders_mint_policy_id: ordersMintConfig.ordersMintPolicyHash.toHex(),
    minting_data_script_hash:
      mintingDataConfig.mintingDataValidatorHash.toHex(),
    orders_minter: ordersMinterPubKeyHash,
    ref_spend_admin: refSpendAdminWallet.spendingPubKeyHash.toHex(),
    max_order_amount: 5,
  };
  const settings: Settings = {
    mint_governor: mintV1Config.mintV1ValidatorHash.toHex(),
    mint_version: mintVersion,
    data: buildSettingsV1Data(settingsV1),
  };

  // prepare db
  // insert 10,000 hal assets names
  // with empty string value
  console.log("======= Starting Pre Filling DB =======\n");
  const assetNames = Array.from({ length: 200 }, (_, i) => `hal-${i + 1}`);
  await fillAssets(db, assetNames, () => {});
  console.log("======= DB Pre Filled =======\n");
  console.log("DB Root Hash:\n", db.hash?.toString("hex"));
  console.log("===========================\n");

  // ============ prepare minting data ============
  const mintingData: MintingData = {
    mpt_root_hash: db.hash?.toString("hex"),
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
  const mintingDataAssetTxInput = await emulator.getUtxo(
    makeTxOutputId(prepareAssetsTxId, 1)
  );

  // ============ Deploy Scripts ============
  const [mintProxyScriptDetails, mintProxyScriptTxInput] = await deployScript(
    ScriptType.DEMI_MINT_PROXY,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(
      mintProxyConfig.mintProxyMintUplcProgram
    )
  );
  const [mintV1ScriptDetails, mintV1ScriptTxInput] = await deployScript(
    ScriptType.DEMI_MINT,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(mintV1Config.mintV1WithdrawUplcProgram)
  );
  const [mintingDataScriptDetails, mintingDataScriptTxInput] =
    await deployScript(
      ScriptType.DEMI_MINTING_DATA,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        mintingDataConfig.mintingDataSpendUplcProgram
      )
    );
  const [ordersMintScriptDetails, ordersMintScriptTxInput] = await deployScript(
    ScriptType.DEMI_ORDERS,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(ordersMintConfig.ordersMintUplcProgram)
  );
  const [ordersSpendScriptDetails, ordersSpendScriptTxInput] =
    await deployScript(
      ScriptType.DEMI_ORDERS,
      emulator,
      fundWallet,
      ...extractScriptCborsFromUplcProgram(
        ordersSpendConfig.ordersSpendUplcProgram
      )
    );
  const [refSpendScriptDetails, refSpendScriptTxInput] = await deployScript(
    ScriptType.DEMI_ORDERS,
    emulator,
    fundWallet,
    ...extractScriptCborsFromUplcProgram(refSpendConfig.refSpendUplcProgram)
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
    mintV1ScriptDetails,
    mintV1ScriptTxInput,
    mintingDataScriptDetails,
    mintingDataScriptTxInput,
    ordersMintScriptDetails,
    ordersMintScriptTxInput,
    ordersSpendScriptDetails,
    ordersSpendScriptTxInput,
    refSpendScriptDetails,
    refSpendScriptTxInput,
  };

  // hoist mocked functions
  const {
    mockedFetchAllDeployedScripts,
    mockedFetchSettings,
    mockedFetchMintingData,
    mockedGetBlockfrostV0Client,
    mockedGetNetwork,
  } = vi.hoisted(() => {
    return {
      mockedFetchAllDeployedScripts: vi.fn(),
      mockedFetchSettings: vi.fn(),
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
      fetchMintingData: mockedFetchMintingData,
    };
  });
  mockedFetchSettings.mockReturnValue(
    new Promise((resolve) =>
      resolve(Ok({ settings, settingsV1: settingsV1, settingsAssetTxInput }))
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

  const ordersTxInputs: TxInput[] = [];

  return {
    network,
    emulator,
    db,
    contractsConfig,
    allowedMinterPubKeyHash,
    legacyPolicyId,
    deployedScripts,
    mockedFunctions: {
      mockedFetchAllDeployedScripts,
      mockedFetchSettings,
      mockedFetchMintingData,
      mockedGetBlockfrostV0Client,
      mockedGetNetwork,
    },
    wallets: {
      fundWallet,
      adminWallet,
      allowedMinterWallet,
      ordersMinterWallet,
      refSpendAdminWallet,
      paymentWallet,
      orderNftsCollectorWallet,
      usersWallets,
    },
    ordersTxInputs,
  };
};

const myTest = test.extend(await setup());

export { myTest };
