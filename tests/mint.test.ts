import {
  makeAddress,
  makeAssetClass,
  makeInlineTxOutputDatum,
  makeTxOutputId,
  makeValidatorHash,
} from "@helios-lang/ledger";
import { Ok } from "ts-res";
import { assert, describe } from "vitest";

import { PREFIX_100 } from "../src/constants/index.js";
import {
  buildOrdersSpendCancelOrderRedeemer,
  buildOrdersSpendRefundOrderRedeemer,
  cancel,
  decodeMintingDataDatum,
  fetchMintingData,
  fetchOrderTxInputs,
  fetchRefSpendSettings,
  fetchSettings,
  HalAssetInfo,
  invariant,
  makeVoidData,
  mayFailTransaction,
  mintRoyalty,
  Order,
  prepareMintTransaction,
  prepareOrders,
  refund,
  request,
  rollBackOrdersFromTries,
  update,
  updateRoyalty,
} from "../src/index.js";
import { myTest } from "./setup.js";
import {
  balanceOfWallet,
  checkMintedAssets,
  collectFee,
  collectFeeAndMinLovelace,
  logMemAndCpu,
  makeHalAssetDatum,
} from "./utils.js";

describe.sequential("Koralab H.A.L Tests", () => {
  myTest(
    "mint royalty nft",
    async ({ isMainnet, emulator, wallets, royalty, deployedScripts }) => {
      const { allowedMinterWallet } = wallets;

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput } = settingsResult.data;

      const txBuilderResult = await mintRoyalty({
        isMainnet,
        royaltyDatum: royalty.dumbRoyaltyDatum,
        deployedScripts,
        settingsAssetTxInput,
      });
      invariant(txBuilderResult.ok, "Royalty Mint Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        allowedMinterWallet.address,
        await allowedMinterWallet.utxos
      ).complete();
      invariant(txResult.ok, "Royalty Mint Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      const txInput = await emulator.getUtxo(makeTxOutputId(tx.id(), 0));
      royalty.txInput = txInput;
    }
  );

  myTest(
    "update royalty nft",
    async ({ isMainnet, emulator, wallets, royalty, deployedScripts }) => {
      const { royaltySpendAdminWallet } = wallets;

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput } = settingsResult.data;

      const royaltyTxInput = royalty.txInput;
      invariant(!!royaltyTxInput, "Royalty is not minted yet");
      const txBuilderResult = await updateRoyalty({
        isMainnet,
        royaltyTxInput,
        newRoyaltyDatum: royalty.dumbRoyaltyDatum,
        deployedScripts,
        settingsAssetTxInput,
        royaltySpendAdmin: royaltySpendAdminWallet.spendingPubKeyHash.toHex(),
      });
      invariant(txBuilderResult.ok, "Royalty Update Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        royaltySpendAdminWallet.address,
        await royaltySpendAdminWallet.utxos
      ).complete();
      invariant(txResult.ok, "Royalty Update Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await royaltySpendAdminWallet.signTx(tx));
      await royaltySpendAdminWallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // user_1 orders 3 new assets
  myTest(
    "user_1 orders 3 new assets",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets } = wallets;
      const user1Wallet = usersWallets[0];
      const orders: Order[] = [
        {
          destinationAddress: user1Wallet.address,
          amount: 3,
          cost: normalPrice * 3n,
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        await user1Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user1Wallet.signTx(tx));
      await user1Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // cannot mint 3 new assets - <hal-1, hal-2, hal-3> as whitelisted
  myTest(
    "cannot mint 3 new assets - <hal-1, hal-2, hal-3> as whitelisted",
    async ({
      isMainnet,
      emulator,
      whitelistDB,
      deployedScripts,
      whitelistMintingTimeOneHourEarly,
      maxOrderAmountInOneTx,
    }) => {
      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = whitelistMintingTimeOneHourEarly;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 0 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 1,
        "Prepare Orders returned Wrong value"
      );
    }
  );

  // mint 3 new assets - <hal-1, hal-2, hal-3>
  myTest(
    "mint 3 new assets - <hal-1, hal-2, hal-3>",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      normalPrice,
      normalMintingTime,
      maxOrderAmountInOneTx,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from({ length: 3 }).map(
        (_, index) => ({
          assetUtf8Name: `hal-${index + 1}`,
          assetDatum: makeHalAssetDatum(`hal-${index + 1}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = normalMintingTime;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      // prepare mint transaction
      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        normalPrice * 3n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting Cost should be greater than ${mintingCost} >= ${expectedMintingCost}`
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // user_4 orders 5 new assets who is whitelisted
  myTest(
    "user_4 orders 5 new assets who is whitelisted",
    async ({ isMainnet, emulator, wallets, whitelistedPrice1 }) => {
      const { usersWallets } = wallets;
      const user4Wallet = usersWallets[3];
      const orders: Order[] = [
        {
          destinationAddress: user4Wallet.address,
          amount: 5,
          cost: whitelistedPrice1 * 5n,
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user4Wallet.address,
        await user4Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user4Wallet.signTx(tx));
      await user4Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // mint 5 new assets - <hal-4, hal-5, hal-6, hal-7, hal-8> as whitelisted
  myTest(
    "mint 5 new assets - <hal-4, hal-5, hal-6, hal-7, hal-8> as whitelisted",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      whitelistedPrice1,
      whitelistMintingTimeTwoHoursEarly,
      maxOrderAmountInOneTx,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from({ length: 5 }).map(
        (_, index) => ({
          assetUtf8Name: `hal-${index + 4}`,
          assetDatum: makeHalAssetDatum(`hal-${index + 4}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = whitelistMintingTimeTwoHoursEarly;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      // prepare mint transaction
      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        whitelistedPrice1 * 5n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting Cost should be greater than ${mintingCost} >= ${expectedMintingCost}`
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // user_1 can update <hal-1> datum
  myTest(
    "user_1 can update <hal-1> datum",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      const { refSpendAdminWallet } = wallets;

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { policy_id, ref_spend_proxy_script_hash } = settingsV1;

      const refSpendSettingsResult = await fetchRefSpendSettings();
      invariant(refSpendSettingsResult.ok, "Ref Spend Settings Fetch Failed");
      const { refSpendSettingsAssetTxInput } = refSpendSettingsResult.data;

      const refSpendProxyScriptAddress = makeAddress(
        isMainnet,
        makeValidatorHash(ref_spend_proxy_script_hash)
      );
      const refUtxos = await emulator.getUtxos(refSpendProxyScriptAddress);

      const assetUtf8Name = "hal-1";
      const assetHexName = Buffer.from(assetUtf8Name).toString("hex");
      const refAssetName = `${PREFIX_100}${assetHexName}`;
      const foundRefUtxo = refUtxos.find((utxo) =>
        utxo.value.assets.hasAssetClass(
          makeAssetClass(`${policy_id}.${refAssetName}`)
        )
      );
      invariant(foundRefUtxo, "Reference Utxo Not Found");
      const newDatum = makeHalAssetDatum("hal-1-updated");

      const txBuilderResult = await update({
        isMainnet,
        assetUtf8Name: "hal-1",
        newDatum,
        refTxInput: foundRefUtxo,
        deployedScripts,
        refSpendSettingsAssetTxInput,
      });
      invariant(txBuilderResult.ok, "Update Tx Building failed");

      const refSpendAdminUtxos = await emulator.getUtxos(
        refSpendAdminWallet.address
      );
      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        refSpendAdminWallet.address,
        refSpendAdminUtxos
      ).complete();
      console.log(txResult);
      invariant(txResult.ok, "Update Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await refSpendAdminWallet.signTx(tx));
      const txId = await refSpendAdminWallet.submitTx(tx);
      emulator.tick(200);

      const updatedUtxo = await emulator.getUtxo(makeTxOutputId(txId, 0));
      invariant(updatedUtxo.datum!.hash.toHex() === newDatum.hash.toHex());
    }
  );

  // user_2 orders 2 new assets 2 times
  myTest(
    "user_2 orders 2 new assets 2 times",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];
      const orders: Order[] = [
        {
          destinationAddress: user2Wallet.address,
          amount: 2,
          cost: normalPrice * 2n,
        },
        {
          destinationAddress: user2Wallet.address,
          amount: 2,
          cost: normalPrice * 2n,
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        await user2Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user2Wallet.signTx(tx));
      await user2Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // cannot mint 2 new assets because one asset name is not pre-defined in MPT - <hal-9, hal-10> and <hal-11, no-hal-12>
  myTest(
    "cannot mint 2 new assets because one asset name is not pre-defined in MPT - <hal-9, hal-10> and <hal-11, no-hal-12>",
    async ({
      isMainnet,
      emulator,
      wallets,
      db,
      whitelistDB,
      deployedScripts,
      normalMintingTime,
      maxOrderAmountInOneTx,
    }) => {
      const { allowedMinterWallet } = wallets;

      const assetsInfo: HalAssetInfo[] = [
        ...Array.from({ length: 3 }).map((_, index) => ({
          assetUtf8Name: `hal-${index + 9}`,
          assetDatum: makeHalAssetDatum(`hal-${index + 9}`),
        })),
        {
          assetUtf8Name: "no-hal-12",
          assetDatum: makeHalAssetDatum("no-hal-12"),
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = normalMintingTime;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(!txResult.ok, "Mint Tx Building Should Fail");
      assert(txResult.error.message.includes("Asset name is not pre-defined"));

      // roll back
      const rollBackResult = await rollBackOrdersFromTries({
        utf8Names: assetsInfo.map((item) => item.assetUtf8Name),
        whitelistedItemsData: [],
        db,
        whitelistDB,
      });
      invariant(rollBackResult.ok, "Roll Back Failed");
    }
  );

  // cannot cancel 2 orders in a transaction
  myTest(
    "cannot cancel 2 orders in a transaction",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(orderTxInputs.length === 2, "Order Tx Inputs should be 2");

      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];

      const txBuilderResult = await cancel({
        isMainnet,
        address: user2Wallet.address,
        orderTxInput: orderTxInputs[0],
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Cancel Tx Building failed");

      // hack: cancel one other order also
      // without burning order token
      const txBuilder = txBuilderResult.data;
      txBuilder.spendUnsafe(
        orderTxInputs[1],
        buildOrdersSpendCancelOrderRedeemer()
      );

      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        await user2Wallet.utxos
      ).complete();
      invariant(!txResult.ok, "Cancel Tx Complete should fail");
      assert(txResult.error.message.includes("expect own_utxo_count == 1"));
    }
  );

  // cannot refund 2 orders in a transaction
  myTest(
    "cannot refund 2 orders in a transaction",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      // fetch
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(orderTxInputs.length === 2, "Order Tx Inputs should be 2");

      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput } = settingsResult.data;

      const txBuilderResult = await refund({
        isMainnet,
        orderTxInput: orderTxInputs[0],
        refundingAddress: user2Wallet.address,
        deployedScripts,
        settingsAssetTxInput,
      });
      invariant(txBuilderResult.ok, "Refund Tx Building failed");

      // hack: cancel one other order also
      // without burning order token
      const txBuilder = txBuilderResult.data;
      txBuilder.spendUnsafe(
        orderTxInputs[1],
        buildOrdersSpendRefundOrderRedeemer()
      );

      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        await user2Wallet.utxos
      ).complete();
      invariant(!txResult.ok, "Refund Tx Complete should fail");
      assert(txResult.error.message.includes("expect own_utxo_count == 1"));
    }
  );

  // can cancel one order
  myTest(
    "can cancel one order",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(orderTxInputs.length === 2, "Order Tx Inputs should be 2");

      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];
      const beforeUser2Lovelace = (await balanceOfWallet(user2Wallet)).lovelace;

      const txBuilderResult = await cancel({
        isMainnet,
        address: user2Wallet.address,
        orderTxInput: orderTxInputs[1],
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Cancel Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        await user2Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Cancel Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await user2Wallet.signTx(tx));
      await user2Wallet.submitTx(tx);
      emulator.tick(200);

      const afterUser2Lovelace = (await balanceOfWallet(user2Wallet)).lovelace;
      const expectedLovelace =
        beforeUser2Lovelace + orderTxInputs[1].value.lovelace - collectFee(tx);
      invariant(
        afterUser2Lovelace === expectedLovelace,
        `User 2 Lovelace is not correct. Expected: ${expectedLovelace}, Actual: ${afterUser2Lovelace}`
      );
    }
  );

  // can refund one order
  myTest(
    "can refund one order",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(orderTxInputs.length === 1, "Order Tx Inputs should be 1");

      const { usersWallets, allowedMinterWallet } = wallets;
      const user2Wallet = usersWallets[1];
      const beforeUser2Lovelace = (await balanceOfWallet(user2Wallet)).lovelace;

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput } = settingsResult.data;

      const txBuilderResult = await refund({
        isMainnet,
        orderTxInput: orderTxInputs[0],
        refundingAddress: user2Wallet.address,
        deployedScripts,
        settingsAssetTxInput,
      });
      invariant(txBuilderResult.ok, "Refund Tx Building failed");

      const txBuilder = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Refund Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      const afterUser2Lovelace = (await balanceOfWallet(user2Wallet)).lovelace;
      const expectedLovelace =
        beforeUser2Lovelace + orderTxInputs[0].value.lovelace - collectFee(tx);
      invariant(
        afterUser2Lovelace === expectedLovelace,
        `User 2 Lovelace is not correct. Expected: ${expectedLovelace}, Actual: ${afterUser2Lovelace}`
      );
    }
  );

  // user_1 request order with invalid datum
  myTest(
    "user_1 request order with invalid datum",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets } = wallets;
      const user1Wallet = usersWallets[0];
      const orders: Order[] = [
        {
          destinationAddress: user1Wallet.address,
          amount: 2,
          cost: normalPrice * 2n,
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      // user_1 make Order UTxO with invalid datum
      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      // remove correct datum
      txBuilder.outputs[0].datum = makeInlineTxOutputDatum(makeVoidData());
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        await user1Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user1Wallet.signTx(tx));
      await user1Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // refund order with invalid datum
  myTest(
    "refund order with invalid datum",
    async ({ isMainnet, emulator, wallets, deployedScripts }) => {
      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(orderTxInputs.length === 1, "Order Tx Inputs should be 1");

      const { usersWallets, allowedMinterWallet } = wallets;
      const user1Wallet = usersWallets[0];
      const beforeUser1Lovelace = (await balanceOfWallet(user1Wallet)).lovelace;

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput } = settingsResult.data;

      const refundingAddress = user1Wallet.address;
      const txBuilderResult = await refund({
        isMainnet,
        orderTxInput: orderTxInputs[0],
        refundingAddress,
        deployedScripts,
        settingsAssetTxInput,
      });
      invariant(txBuilderResult.ok, "Refund Tx Building failed");

      const txBuilder = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        refundingAddress,
        []
      ).complete();
      invariant(txResult.ok, "Refund Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      const afterUser1Lovelace = (await balanceOfWallet(user1Wallet)).lovelace;
      const expectedLovelace =
        beforeUser1Lovelace + orderTxInputs[0].value.lovelace - collectFee(tx);
      invariant(
        afterUser1Lovelace === expectedLovelace,
        `User 1 Lovelace is not correct. Expected: ${expectedLovelace}, Actual: ${afterUser1Lovelace}`
      );
    }
  );

  // user_1 orders 3 new assets
  myTest(
    "user_1 orders 3 new assets",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets } = wallets;
      const user1Wallet = usersWallets[0];
      const orders: Order[] = [
        {
          destinationAddress: user1Wallet.address,
          amount: 3,
          cost: normalPrice * 3n,
        },
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        await user1Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user1Wallet.signTx(tx));
      await user1Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // mint 3 new assets - <hal-9, hal-10, hal-11>
  myTest(
    "mint 3 new assets - <hal-9, hal-10, hal-11>",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      normalPrice,
      normalMintingTime,
      maxOrderAmountInOneTx,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 3 },
        (_, index) => ({
          assetUtf8Name: `hal-${9 + index}`,
          assetDatum: makeHalAssetDatum(`hal-${9 + index}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = normalMintingTime;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        normalPrice * 3n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting Cost should be greater than ${mintingCost} >= ${expectedMintingCost}`
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // user_3 orders 5 new assets 3 times
  myTest(
    "user_3 orders 5 new assets 3 times",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets } = wallets;
      const user3Wallet = usersWallets[2];
      const orders: Order[] = Array.from({ length: 3 }, () => ({
        destinationAddress: user3Wallet.address,
        amount: 5,
        cost: normalPrice * 5n,
      }));

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user3Wallet.address,
        await user3Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user3Wallet.signTx(tx));
      await user3Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // mint 15 new assets - <hal-101 ~ hal-115> - 1 user recieve 15 assets
  myTest(
    "mint 15 new assets - <hal-101 ~ hal-115> - 1 user recieve 15 assets",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      normalPrice,
      normalMintingTime,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 15 },
        (_, index) => ({
          assetUtf8Name: `hal-${101 + index}`,
          assetDatum: makeHalAssetDatum(`hal-${101 + index}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = normalMintingTime;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx: 15,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        normalPrice * 15n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting Cost should be greater than ${mintingCost} >= ${expectedMintingCost}`
      );

      // check user outputs data
      invariant(
        userOutputsData.length === 1,
        "User Outputs Data List Length is not correct"
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // user_1, user_2, user_3 order 5 new assets
  myTest(
    "user_1, user_2, user_3 order 5 new assets",
    async ({ isMainnet, emulator, wallets, normalPrice }) => {
      const { usersWallets, fundWallet } = wallets;
      const orders: Order[] = Array.from({ length: 3 }, (_, index) => ({
        destinationAddress: usersWallets[index].address,
        amount: 5,
        cost: normalPrice * 5n,
      }));

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        fundWallet.address,
        await fundWallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await fundWallet.signTx(tx));
      await fundWallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // mint 15 new assets - <hal-151 ~ hal-165> - 3 users recieve 5 assets each
  myTest(
    "mint 15 new assets - <hal-151 ~ hal-165> - 3 users recieve 5 assets each",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      normalPrice,
      normalMintingTime,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 15 },
        (_, index) => ({
          assetUtf8Name: `hal-${151 + index}`,
          assetDatum: makeHalAssetDatum(`hal-${151 + index}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;

      // start minting
      const mintingTime = normalMintingTime;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx: 15,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;

      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 3 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        normalPrice * 15n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting Cost should be greater than ${mintingCost} >= ${expectedMintingCost}`
      );

      invariant(
        userOutputsData.length === 3,
        "User Outputs Data List Length is not correct"
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // user_4 orders 9 new assets who is whitelisted
  myTest(
    "user_4 orders 9 new assets who is whitelisted",
    async ({
      isMainnet,
      emulator,
      wallets,
      whitelistedPrice1,
      whitelistedPrice2,
    }) => {
      const { usersWallets } = wallets;
      const user4Wallet = usersWallets[3];
      const orders: Order[] = [
        ...Array.from({ length: 5 }, () => ({
          destinationAddress: user4Wallet.address,
          amount: 1,
          cost: whitelistedPrice1,
        })),
        ...Array.from({ length: 4 }, () => ({
          destinationAddress: user4Wallet.address,
          amount: 1,
          cost: whitelistedPrice2,
        })),
      ];

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user4Wallet.address,
        await user4Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await user4Wallet.signTx(tx));
      await user4Wallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // can mint 9 new assets - <hal-201 ~ hal-209> as whitelisted
  myTest(
    "can mint 9 new assets - <hal-201 ~ hal-209> as whitelisted",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      whitelistedPrice1,
      whitelistedPrice2,
      whitelistMintingTimeOneHourEarly,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 9 },
        (_, index) => ({
          assetUtf8Name: `hal-20${index + 1}`,
          assetDatum: makeHalAssetDatum(`hal-20${index + 1}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(
        orderTxInputs.length === 9,
        "Order Tx Inputs Length is not correct"
      );

      // start minting
      const mintingTime = whitelistMintingTimeOneHourEarly;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx: 9,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;
      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 1 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        whitelistedPrice1 * 5n +
        whitelistedPrice2 * 4n -
        collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting cost must match ${mintingCost} == ${expectedMintingCost}`
      );

      // check user outputs data
      invariant(
        userOutputsData.length === 1,
        "User Outputs Data List Length is not correct"
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // special user_1 ~ user_8 orders 8 new assets
  myTest(
    "special user_1 ~ user_8 orders 8 new assets",
    async ({ isMainnet, emulator, wallets, whitelistedPrice1 }) => {
      const { specialUsersWallets, fundWallet } = wallets;
      const orders: Order[] = Array.from({ length: 8 }, (_, index) => ({
        destinationAddress: specialUsersWallets[index].address,
        amount: 1,
        cost: whitelistedPrice1,
      }));

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        fundWallet.address,
        await fundWallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await fundWallet.signTx(tx));
      await fundWallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // can mint 8 new assets from 8 order UTxOs - <hal-301 ~ hal-308> as whitelisted
  myTest(
    "can mint 8 new assets from 8 order UTxOs - <hal-301 ~ hal-308> as whitelisted",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      whitelistedPrice1,
      whitelistMintingTimeTwoHoursEarly,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 8 },
        (_, index) => ({
          assetUtf8Name: `hal-30${index + 1}`,
          assetDatum: makeHalAssetDatum(`hal-30${index + 1}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(
        orderTxInputs.length === 8,
        "Order Tx Inputs Length is not correct"
      );

      // start minting
      const mintingTime = whitelistMintingTimeTwoHoursEarly;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx: 8,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");

      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;
      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 8 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      // prepare mint transaction
      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check user outputs data
      invariant(
        userOutputsData.length === 8,
        "User Outputs Data List Length is not correct"
      );

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        whitelistedPrice1 * 8n - collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting cost must match ${mintingCost} == ${expectedMintingCost}`
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );

  // special user_1 ~ user_4 orders 8 new assets
  myTest(
    "special user_1 ~ user_4 orders 8 new assets",
    async ({
      isMainnet,
      emulator,
      wallets,
      whitelistedPrice1,
      whitelistedPrice2,
    }) => {
      const { specialUsersWallets, fundWallet } = wallets;
      const orders: Order[] = Array.from({ length: 4 }, (_, index) => ({
        destinationAddress: specialUsersWallets[index].address,
        amount: 2,
        cost: whitelistedPrice1 + whitelistedPrice2,
      }));

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settings } = settingsResult.data;

      const txBuilderResult = await request({
        isMainnet,
        orders,
        settings,
        maxOrderAmountInOneTx: 8,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        fundWallet.address,
        await fundWallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");

      const { tx } = txResult.data;
      tx.addSignatures(await fundWallet.signTx(tx));
      await fundWallet.submitTx(tx);
      emulator.tick(200);
    }
  );

  // can mint 8 new assets from 4 order UTxOs - <hal-401 ~ hal-408> as whitelisted
  myTest(
    "can mint 8 new assets from 4 order UTxOs - <hal-401 ~ hal-408> as whitelisted",
    async ({
      isMainnet,
      emulator,
      wallets,
      mockedFunctions,
      db,
      whitelistDB,
      deployedScripts,
      whitelistedPrice1,
      whitelistedPrice2,
      whitelistMintingTimeOneHourEarly,
    }) => {
      const { allowedMinterWallet, paymentWallet } = wallets;
      const beforePaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;

      const assetsInfo: HalAssetInfo[] = Array.from(
        { length: 8 },
        (_, index) => ({
          assetUtf8Name: `hal-40${index + 1}`,
          assetDatum: makeHalAssetDatum(`hal-40${index + 1}`),
        })
      );

      const settingsResult = await fetchSettings(isMainnet);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
      const mintingDataResult = await fetchMintingData();
      invariant(mintingDataResult.ok, "Minting Data Fetch failed");
      const { mintingDataAssetTxInput } = mintingDataResult.data;

      // fetch order tx inputs
      const orderTxInputsResult = await fetchOrderTxInputs({
        cardanoClient: emulator,
        ordersSpendScriptDetails: deployedScripts.ordersSpendScriptDetails,
      });
      invariant(orderTxInputsResult.ok, "Order Tx Inputs Fetch Failed");
      const orderTxInputs = orderTxInputsResult.data;
      invariant(
        orderTxInputs.length === 4,
        "Order Tx Inputs Length is not correct"
      );

      // start minting
      const mintingTime = whitelistMintingTimeOneHourEarly;

      // prepare orders
      const prepareOrdersResult = await prepareOrders({
        isMainnet,
        orderTxInputs,
        settingsV1,
        whitelistDB,
        mintingTime,
        maxOrderAmountInOneTx: 8,
        maxTxsPerLambda: 8,
        remainingHals: 10000,
      });
      invariant(prepareOrdersResult.ok, "Prepare Orders Failed");
      const {
        aggregatedOrdersList,
        unpickedOrderTxInputs,
        invalidOrderTxInputs,
      } = prepareOrdersResult.data;
      invariant(
        aggregatedOrdersList.length === 1 &&
          aggregatedOrdersList[0].length === 4 &&
          unpickedOrderTxInputs.length === 0 &&
          invalidOrderTxInputs.length === 0,
        "Prepare Orders returned Wrong value"
      );

      const txBuilderResult = await prepareMintTransaction({
        isMainnet,
        address: allowedMinterWallet.address,
        aggregatedOrders: aggregatedOrdersList[0],
        assetsInfo,
        db,
        whitelistDB,
        deployedScripts,
        settingsAssetTxInput,
        mintingDataAssetTxInput,
        mintingTime,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder, userOutputsData, referenceOutputs } =
        txBuilderResult.data;
      txBuilder.addOutput(
        ...userOutputsData.map((item) => item.userOutput),
        ...referenceOutputs
      );

      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      // set emulator time
      emulator.currentSlot = Math.ceil(mintingTime / 1000);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check user outputs data
      invariant(
        userOutputsData.length === 4,
        "User Outputs Data List Length is not correct"
      );

      // check minting cost
      const afterPaymentWalletLovelace = (await balanceOfWallet(paymentWallet))
        .lovelace;
      const mintingCost =
        afterPaymentWalletLovelace - beforePaymentWalletLovelace;
      const expectedMintingCost =
        (whitelistedPrice1 + whitelistedPrice2) * 4n -
        collectFeeAndMinLovelace(tx);
      invariant(
        mintingCost === expectedMintingCost,
        `Minting cost must match ${mintingCost} == ${expectedMintingCost}`
      );

      // check minted assets
      await checkMintedAssets(isMainnet, emulator, settingsV1, userOutputsData);

      // update minting data input
      const newMintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const newMintingData = decodeMintingDataDatum(
        newMintingDataAssetTxInput.datum
      );
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData: newMintingData,
              mintingDataAssetTxInput: newMintingDataAssetTxInput,
            })
          )
        )
      );
    }
  );
});
