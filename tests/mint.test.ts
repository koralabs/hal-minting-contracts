import { makeAssetClass, makeTxOutputId } from "@helios-lang/ledger";
import { Ok } from "ts-res";
import { assert, describe } from "vitest";

import {
  HAL_NFT_PRICE,
  PREFIX_100,
  PREFIX_222,
} from "../src/constants/index.js";
import {
  buildOrdersSpendCancelOrderRedeemer,
  cancel,
  decodeMintingDataDatum,
  fetchSettings,
  inspect,
  invariant,
  mayFailTransaction,
  Order,
  prepareMintTransaction,
  request,
  rollBackOrdersFromTrie,
  update,
} from "../src/index.js";
import { myTest } from "./setup.js";
import {
  balanceOfAddress,
  balanceOfWallet,
  logMemAndCpu,
  makeHalAssetDatum,
  referenceAssetValue,
  userAssetValue,
} from "./utils.js";

describe.sequential("Koralab H.A.L Tests", () => {
  // user_1 orders 2 new assets
  myTest(
    "user_1 orders 2 new assets",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets, ordersMinterWallet } = wallets;
      const user1Wallet = usersWallets[0];

      const txBuilderResult = await request({
        network,
        address: user1Wallet.address,
        amount: 2,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        await user1Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures([
        ...(await user1Wallet.signTx(tx)),
        ...(await ordersMinterWallet.signTx(tx)),
      ]);
      const txId = await user1Wallet.submitTx(tx);
      emulator.tick(200);

      const orderTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
      ordersTxInputs.push(orderTxInput);
    }
  );

  // mint 2 new assets - <hal-1, hal-2>
  myTest(
    "mint 2 new assets - <hal-1, hal-2>",
    async ({
      mockedFunctions,
      db,
      network,
      emulator,
      wallets,
      ordersTxInputs,
      deployedScripts,
    }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const {
        usersWallets,
        allowedMinterWallet,
        paymentWallet,
        orderNftsCollectorWallet,
      } = wallets;
      const user1Wallet = usersWallets[0];

      const assetNamesList = [["hal-1", "hal-2"]];
      const orders: Order[] = ordersTxInputs.map((orderTxInput, index) => ({
        orderTxInput,
        assetsInfo: assetNamesList[index].map((assetName) => [
          assetName,
          makeHalAssetDatum(assetName),
        ]),
      }));

      const txBuilderResult = await prepareMintTransaction({
        network,
        address: allowedMinterWallet.address,
        orderNftsCollector: orderNftsCollectorWallet.address,
        orders,
        db,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder } = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minted values
      const settingsResult = await fetchSettings(network);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { ref_spend_script_address } = settingsV1;
      const user1Balance = await balanceOfWallet(user1Wallet);
      const refSpendBalance = await balanceOfAddress(
        emulator,
        ref_spend_script_address
      );

      for (const assetName of assetNamesList[0]) {
        assert(
          user1Balance.isGreaterOrEqual(
            userAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "User 1 Wallet Balance is not correct"
        );
        assert(
          refSpendBalance.isGreaterOrEqual(
            referenceAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "Ref Spend Wallet Balance is not correct"
        );
      }

      // update minting data input
      const mintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const mintingData = decodeMintingDataDatum(mintingDataAssetTxInput.datum);
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData,
              mintingDataAssetTxInput,
            })
          )
        )
      );

      // empty orders detail
      ordersTxInputs.length = 0;

      // inspect db
      inspect(db);
    }
  );

  // user_1 orders 3 new assets
  myTest(
    "user_1 orders 3 new assets",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets, ordersMinterWallet } = wallets;
      const user1Wallet = usersWallets[0];

      const txBuilderResult = await request({
        network,
        address: user1Wallet.address,
        amount: 3,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        await user1Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures([
        ...(await user1Wallet.signTx(tx)),
        ...(await ordersMinterWallet.signTx(tx)),
      ]);
      const txId = await user1Wallet.submitTx(tx);
      emulator.tick(200);

      const orderTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
      ordersTxInputs.push(orderTxInput);
    }
  );

  // user_2 orders 3 new assets
  myTest(
    "user_2 orders 3 new assets",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets, ordersMinterWallet } = wallets;
      const user2Wallet = usersWallets[1];

      const txBuilderResult = await request({
        network,
        address: user2Wallet.address,
        amount: 3,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Order Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user2Wallet.address,
        await user2Wallet.utxos
      ).complete();
      invariant(txResult.ok, "Order Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures([
        ...(await user2Wallet.signTx(tx)),
        ...(await ordersMinterWallet.signTx(tx)),
      ]);
      const txId = await user2Wallet.submitTx(tx);
      emulator.tick(200);

      const orderTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
      ordersTxInputs.push(orderTxInput);
    }
  );

  // mint 6 new assets - <hal-3, hal-4, hal-5> for user_1 and <hal-6, hal-7, hal-8> for user_2
  myTest(
    "mint 6 new assets - <hal-3, hal-4, hal-5> for user_1 and <hal-6, hal-7, hal-8> for user_2",
    async ({
      mockedFunctions,
      db,
      network,
      emulator,
      wallets,
      ordersTxInputs,
      deployedScripts,
    }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const {
        usersWallets,
        allowedMinterWallet,
        paymentWallet,
        orderNftsCollectorWallet,
      } = wallets;
      const [user1Wallet, user2Wallet] = usersWallets;

      const assetNamesList = [
        ["hal-3", "hal-4", "hal-5"],
        ["hal-6", "hal-7", "hal-8"],
      ];
      const orders: Order[] = ordersTxInputs.map((orderTxInput, index) => ({
        orderTxInput,
        assetsInfo: assetNamesList[index].map((assetName) => [
          assetName,
          makeHalAssetDatum(assetName),
        ]),
      }));

      const txBuilderResult = await prepareMintTransaction({
        network,
        address: allowedMinterWallet.address,
        orderNftsCollector: orderNftsCollectorWallet.address,
        orders,
        db,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder } = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minted values
      const settingsResult = await fetchSettings(network);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { ref_spend_script_address } = settingsV1;
      const user1Balance = await balanceOfWallet(user1Wallet);
      const user2Balance = await balanceOfWallet(user2Wallet);
      const refSpendBalance = await balanceOfAddress(
        emulator,
        ref_spend_script_address
      );

      for (const assetName of assetNamesList[0]) {
        assert(
          user1Balance.isGreaterOrEqual(
            userAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "User 1 Wallet Balance is not correct"
        );
        assert(
          refSpendBalance.isGreaterOrEqual(
            referenceAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "Ref Spend Wallet Balance is not correct"
        );
      }
      for (const assetName of assetNamesList[1]) {
        assert(
          user2Balance.isGreaterOrEqual(
            userAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "User 2 Wallet Balance is not correct"
        );
        assert(
          refSpendBalance.isGreaterOrEqual(
            referenceAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "Ref Spend Wallet Balance is not correct"
        );
      }

      // update minting data input
      const mintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const mintingData = decodeMintingDataDatum(mintingDataAssetTxInput.datum);
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData,
              mintingDataAssetTxInput,
            })
          )
        )
      );

      // empty orders detail
      ordersTxInputs.length = 0;

      // inspect db
      inspect(db);
    }
  );

  // user_1 can update <hal-1> datum
  myTest(
    "user_1 can update <hal-1> datum",
    async ({ network, emulator, wallets, deployedScripts }) => {
      const { usersWallets, refSpendAdminWallet } = wallets;
      const user1Wallet = usersWallets[0];

      const settingsResult = await fetchSettings(network);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { policy_id, ref_spend_script_address } = settingsV1;
      const refUtxos = await emulator.getUtxos(ref_spend_script_address);

      const assetUtf8Name = "hal-1";
      const assetHexName = Buffer.from(assetUtf8Name).toString("hex");
      const refAssetName = `${PREFIX_100}${assetHexName}`;
      const userAssetName = `${PREFIX_222}${assetHexName}`;
      const foundRefUtxo = refUtxos.find((utxo) =>
        utxo.value.assets.hasAssetClass(
          makeAssetClass(`${policy_id}.${refAssetName}`)
        )
      );
      invariant(foundRefUtxo, "Reference Utxo Not Found");
      const userUtxos = await user1Wallet.utxos;
      const foundUserUtxo = userUtxos.find((utxo) =>
        utxo.value.assets.hasAssetClass(
          makeAssetClass(`${policy_id}.${userAssetName}`)
        )
      );
      invariant(foundUserUtxo, "User Utxo Not Found");

      const newDatum = makeHalAssetDatum("hal-1-updated");

      const txBuilderResult = await update({
        network,
        assetUtf8Name: "hal-1",
        newDatum,
        refTxInput: foundRefUtxo,
        userTxInput: foundUserUtxo,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Update Tx Building failed");

      const txBuilder = txBuilderResult.data;
      const txResult = await mayFailTransaction(
        txBuilder,
        user1Wallet.address,
        userUtxos
      ).complete();
      invariant(txResult.ok, "Update Tx Complete failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures([
        ...(await refSpendAdminWallet.signTx(tx)),
        ...(await user1Wallet.signTx(tx)),
      ]);
      const txId = await user1Wallet.submitTx(tx);
      emulator.tick(200);

      const updatedUtxo = await emulator.getUtxo(makeTxOutputId(txId, 0));
      invariant(updatedUtxo.datum!.hash.toHex() === newDatum.hash.toHex());
    }
  );

  // user_2 orders 2 new assets 2 times
  myTest(
    "user_2 orders 2 new assets 2 times",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets, ordersMinterWallet } = wallets;
      const user2Wallet = usersWallets[1];

      for (let i = 0; i < 2; i++) {
        const txBuilderResult = await request({
          network,
          address: user2Wallet.address,
          amount: 2,
          deployedScripts,
        });
        invariant(txBuilderResult.ok, "Order Tx Building failed");

        const txBuilder = txBuilderResult.data;
        const txResult = await mayFailTransaction(
          txBuilder,
          user2Wallet.address,
          await user2Wallet.utxos
        ).complete();
        invariant(txResult.ok, "Order Tx Complete failed");
        logMemAndCpu(txResult);

        const { tx } = txResult.data;
        tx.addSignatures([
          ...(await user2Wallet.signTx(tx)),
          ...(await ordersMinterWallet.signTx(tx)),
        ]);
        const txId = await user2Wallet.submitTx(tx);
        emulator.tick(200);

        const orderTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
        ordersTxInputs.push(orderTxInput);
      }
    }
  );

  // cannot mint 2 new assets because one asset name is not pre-defined in MPT - <hal-9, hal-10> and <hal-11, no-hal-12>
  myTest(
    "cannot mint 2 new assets because one asset name is not pre-defined in MPT - <hal-9, hal-10> and <hal-11, no-hal-12>",
    async ({ network, db, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { allowedMinterWallet, orderNftsCollectorWallet } = wallets;

      const assetNamesList = [
        ["hal-9", "hal-10"],
        ["hal-11", "no-hal-12"],
      ];
      const orders: Order[] = ordersTxInputs.map((orderTxInput, index) => ({
        orderTxInput,
        assetsInfo: assetNamesList[index].map((assetName) => [
          assetName,
          makeHalAssetDatum(assetName),
        ]),
      }));

      const txResult = await prepareMintTransaction({
        network,
        address: allowedMinterWallet.address,
        orderNftsCollector: orderNftsCollectorWallet.address,
        orders,
        db,
        deployedScripts,
      });
      invariant(!txResult.ok, "Mint Tx Building Should Fail");
      assert(txResult.error.message.includes("Asset name is not pre-defined"));

      // roll back
      const rollBackResult = await rollBackOrdersFromTrie({
        orders,
        db,
      });
      invariant(rollBackResult.ok, "Roll Back Failed");
    }
  );

  // cannot cancel 2 orders in a transaction
  myTest(
    "cannot cancel 2 orders in a transaction",
    async ({ network, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];

      const txBuilderResult = await cancel({
        network,
        address: user2Wallet.address,
        orderTxInput: ordersTxInputs[0],
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Cancel Tx Building failed");

      // hack: cancel one other order also
      // without burning order token
      const txBuilder = txBuilderResult.data;
      txBuilder.spendUnsafe(
        ordersTxInputs[1],
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

  // can cancel one order
  myTest(
    "can cancel one order",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets } = wallets;
      const user2Wallet = usersWallets[1];
      const beforeUser2Lovelace = (await balanceOfWallet(user2Wallet)).lovelace;

      const txBuilderResult = await cancel({
        network,
        address: user2Wallet.address,
        orderTxInput: ordersTxInputs[1],
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

      invariant(
        afterUser2Lovelace - beforeUser2Lovelace > HAL_NFT_PRICE - 1_000_000n,
        "User 2 Lovelace is not correct"
      );

      ordersTxInputs.splice(1, 1);
    }
  );

  // mint 2 new assets - <hal-9, hal-10>
  myTest(
    "mint 2 new assets - <hal-9, hal-10>",
    async ({
      mockedFunctions,
      db,
      network,
      emulator,
      wallets,
      ordersTxInputs,
      deployedScripts,
    }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const {
        usersWallets,
        allowedMinterWallet,
        paymentWallet,
        orderNftsCollectorWallet,
      } = wallets;
      const user2Wallet = usersWallets[1];

      const assetNamesList = [["hal-9", "hal-10"]];
      const orders: Order[] = ordersTxInputs.map((orderTxInput, index) => ({
        orderTxInput,
        assetsInfo: assetNamesList[index].map((assetName) => [
          assetName,
          makeHalAssetDatum(assetName),
        ]),
      }));

      const txBuilderResult = await prepareMintTransaction({
        network,
        address: allowedMinterWallet.address,
        orderNftsCollector: orderNftsCollectorWallet.address,
        orders,
        db,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder } = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minted values
      const settingsResult = await fetchSettings(network);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { ref_spend_script_address } = settingsV1;
      const user2Balance = await balanceOfWallet(user2Wallet);
      const refSpendBalance = await balanceOfAddress(
        emulator,
        ref_spend_script_address
      );

      for (const assetName of assetNamesList[0]) {
        assert(
          user2Balance.isGreaterOrEqual(
            userAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "User 1 Wallet Balance is not correct"
        );
        assert(
          refSpendBalance.isGreaterOrEqual(
            referenceAssetValue(settingsV1.policy_id, assetName)
          ) == true,
          "Ref Spend Wallet Balance is not correct"
        );
      }

      // update minting data input
      const mintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const mintingData = decodeMintingDataDatum(mintingDataAssetTxInput.datum);
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData,
              mintingDataAssetTxInput,
            })
          )
        )
      );

      // empty orders detail
      ordersTxInputs.length = 0;

      // inspect db
      inspect(db);
    }
  );

  // user_3 orders 5 new assets 2 times
  myTest(
    "user_3 orders 5 new assets 2 times",
    async ({ network, emulator, wallets, ordersTxInputs, deployedScripts }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const { usersWallets, ordersMinterWallet } = wallets;
      const user3Wallet = usersWallets[2];

      for (let i = 0; i < 2; i++) {
        const txBuilderResult = await request({
          network,
          address: user3Wallet.address,
          amount: 5,
          deployedScripts,
        });
        invariant(txBuilderResult.ok, "Order Tx Building failed");

        const txBuilder = txBuilderResult.data;
        const txResult = await mayFailTransaction(
          txBuilder,
          user3Wallet.address,
          await user3Wallet.utxos
        ).complete();
        invariant(txResult.ok, "Order Tx Complete failed");
        logMemAndCpu(txResult);

        const { tx } = txResult.data;
        tx.addSignatures([
          ...(await user3Wallet.signTx(tx)),
          ...(await ordersMinterWallet.signTx(tx)),
        ]);
        const txId = await user3Wallet.submitTx(tx);
        emulator.tick(200);

        const orderTxInput = await emulator.getUtxo(makeTxOutputId(txId, 0));
        ordersTxInputs.push(orderTxInput);
      }
    }
  );

  // mint 10 new assets - <hal-101 ~ hal-110>
  myTest(
    "mint 10 new assets - <hal-101 ~ hal-110>",
    async ({
      mockedFunctions,
      db,
      network,
      emulator,
      wallets,
      ordersTxInputs,
      deployedScripts,
    }) => {
      invariant(
        Array.isArray(ordersTxInputs),
        "Orders tx inputs is not an array"
      );

      const {
        usersWallets,
        allowedMinterWallet,
        paymentWallet,
        orderNftsCollectorWallet,
      } = wallets;
      const user3Wallet = usersWallets[2];

      const assetNamesList = Array.from({ length: 2 }, (_, outerIndex) =>
        Array.from(
          { length: 5 },
          (_, index) => `hal-${101 + outerIndex * 5 + index}`
        )
      );
      const orders: Order[] = ordersTxInputs.map((orderTxInput, index) => ({
        orderTxInput,
        assetsInfo: assetNamesList[index].map((assetName) => [
          assetName,
          makeHalAssetDatum(assetName),
        ]),
      }));

      const txBuilderResult = await prepareMintTransaction({
        network,
        address: allowedMinterWallet.address,
        orderNftsCollector: orderNftsCollectorWallet.address,
        orders,
        db,
        deployedScripts,
      });
      invariant(txBuilderResult.ok, "Mint Tx Building Failed");

      const { txBuilder } = txBuilderResult.data;
      txBuilder.addCollateral((await allowedMinterWallet.utxos)[0]);
      const txResult = await mayFailTransaction(
        txBuilder,
        paymentWallet.address,
        []
      ).complete();
      invariant(txResult.ok, "Mint Tx Complete Failed");
      logMemAndCpu(txResult);

      const { tx } = txResult.data;
      tx.addSignatures(await allowedMinterWallet.signTx(tx));
      const txId = await allowedMinterWallet.submitTx(tx);
      emulator.tick(200);

      // check minted values
      const settingsResult = await fetchSettings(network);
      invariant(settingsResult.ok, "Settings Fetch Failed");
      const { settingsV1 } = settingsResult.data;
      const { ref_spend_script_address } = settingsV1;
      const user3Balance = await balanceOfWallet(user3Wallet);
      const refSpendBalance = await balanceOfAddress(
        emulator,
        ref_spend_script_address
      );

      for (const assetNames of assetNamesList) {
        for (const assetName of assetNames) {
          assert(
            user3Balance.isGreaterOrEqual(
              userAssetValue(settingsV1.policy_id, assetName)
            ) == true,
            "User 3 Wallet Balance is not correct"
          );
          assert(
            refSpendBalance.isGreaterOrEqual(
              referenceAssetValue(settingsV1.policy_id, assetName)
            ) == true,
            "Ref Spend Wallet Balance is not correct"
          );
        }
      }

      // update minting data input
      const mintingDataAssetTxInput = await emulator.getUtxo(
        makeTxOutputId(txId, 0)
      );
      const mintingData = decodeMintingDataDatum(mintingDataAssetTxInput.datum);
      mockedFunctions.mockedFetchMintingData.mockReturnValue(
        new Promise((resolve) =>
          resolve(
            Ok({
              mintingData,
              mintingDataAssetTxInput,
            })
          )
        )
      );

      // empty orders detail
      ordersTxInputs.length = 0;

      // inspect db
      inspect(db);
    }
  );
});
