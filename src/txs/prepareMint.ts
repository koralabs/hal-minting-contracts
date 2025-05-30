import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { ByteArrayLike, IntLike } from "@helios-lang/codec-utils";
import {
  Address,
  makeAssetClass,
  makeAssets,
  makeInlineTxOutputDatum,
  makeMintingPolicyHash,
  makePubKeyHash,
  makeStakingAddress,
  makeStakingValidatorHash,
  makeValue,
} from "@helios-lang/ledger";
import { makeTxBuilder, NetworkName, TxBuilder } from "@helios-lang/tx-utils";
import { Err, Ok, Result } from "ts-res";

import { fetchMintingData, fetchSettings } from "../configs/index.js";
import {
  MPT_MINTED_VALUE,
  ORDER_ASSET_HEX_NAME,
  PREFIX_100,
  PREFIX_222,
} from "../constants/index.js";
import {
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintV1MintHandlesRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  decodeOrderDatum,
  Fulfilment,
  makeVoidData,
  MintingData,
  parseMPTProofJSON,
  Settings,
  SettingsV1,
} from "../contracts/index.js";
import { convertError, mayFail } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";
import { DecodedOrder, Order } from "./types.js";

/**
 * @interface
 * @typedef {object} PrepareMintParams
 * @property {NetworkName} network Network
 * @property {Address} address Wallet Address to perform mint
 * @property {Address} orderNftsCollector Wallet Address where Order Nfts are collected
 * @property {Order[]} orders Orders
 * @property {Trie} db Trie DB
 * @property {DeployedScripts} deployedScripts Deployed Scripts
 */
interface PrepareMintParams {
  network: NetworkName;
  address: Address;
  orderNftsCollector: Address;
  orders: Order[];
  db: Trie;
  deployedScripts: DeployedScripts;
}

/**
 * @description Mint New Handles from Order
 * @param {PrepareMintParams} params
 * @returns {Promise<Result<TxBuilder,  Error>>} Transaction Result
 */
const prepareMintTransaction = async (
  params: PrepareMintParams
): Promise<
  Result<
    {
      txBuilder: TxBuilder;
      settings: Settings;
      settingsV1: SettingsV1;
      totalPrice: bigint;
    },
    Error
  >
> => {
  const { network, address, orderNftsCollector, orders, db, deployedScripts } =
    params;
  const isMainnet = network == "mainnet";
  if (address.era == "Byron")
    return Err(new Error("Byron Address not supported"));

  // refactor Orders Tx Inputs
  // NOTE:
  // sort orderUtxos before process
  // because tx inputs is sorted lexicographically
  // we have to insert handle in `REVERSE` order as tx inputs
  orders
    .sort((a, b) =>
      a.orderTxInput.id.toString() > b.orderTxInput.id.toString() ? 1 : -1
    )
    .reverse();
  if (orders.length == 0) return Err(new Error("No Order requested"));
  console.log(`${orders.length} Orders are picked`);

  const decodedOrders: DecodedOrder[] = [];
  for (const order of orders) {
    const { orderTxInput, assetsInfo } = order;
    const decodedOrderResult = mayFail(() =>
      decodeOrderDatum(orderTxInput.datum, network)
    );
    if (!decodedOrderResult.ok) {
      return Err(new Error(`Invalid Order Datum: ${decodedOrderResult.error}`));
    }
    const { destination_address, price, amount } = decodedOrderResult.data;
    decodedOrders.push({
      orderTxInput,
      assetsInfo,
      destinationAddress: destination_address,
      price,
      amount,
    });
  }

  const {
    mintProxyScriptTxInput,
    mintingDataScriptTxInput,
    mintV1ScriptDetails,
    mintV1ScriptTxInput,
    ordersSpendScriptTxInput,
  } = deployedScripts;

  // fetch settings
  const settingsResult = await fetchSettings(network);
  if (!settingsResult.ok)
    return Err(new Error(`Failed to fetch settings: ${settingsResult.error}`));
  const { settings, settingsV1, settingsAssetTxInput } = settingsResult.data;
  const {
    policy_id,
    allowed_minter,
    orders_mint_policy_id,
    ref_spend_script_address,
  } = settingsV1;

  // hal policy id
  const halPolicyHash = makeMintingPolicyHash(policy_id);

  const mintingDataResult = await fetchMintingData();
  if (!mintingDataResult.ok)
    return Err(
      new Error(`Failed to fetch minting data: ${mintingDataResult.error}`)
    );
  const { mintingData, mintingDataAssetTxInput } = mintingDataResult.data;

  // check if current db trie hash is same as minting data root hash
  if (
    mintingData.mpt_root_hash.toLowerCase() !=
    (db.hash?.toString("hex") || Buffer.alloc(32).toString("hex")).toLowerCase()
  ) {
    return Err(new Error("ERROR: Local DB and On Chain Root Hash mismatch"));
  }

  const totalPrice = decodedOrders.reduce(
    (acc, cur) => acc + BigInt(cur.amount) * cur.price,
    0n
  );

  // make Fulfilments for Minting Data V1 Redeemer
  // prepare H.A.L. NFTs value to mint
  const fulfilments: Fulfilment[] = [];
  const mintingHalsData = [];
  const halTokenValue: [ByteArrayLike, IntLike][] = [];

  for (const decodedOrder of decodedOrders) {
    const fulfilment: Fulfilment = [];
    const refOutputsData = [];
    const userValue = makeValue(1n);
    const { orderTxInput, assetsInfo, destinationAddress, amount } =
      decodedOrder;

    if (assetsInfo.length !== amount) {
      return Err(
        new Error(
          `The number of Assets in Fulfilment is different from amount from Order Datum.`
        )
      );
    }

    for (const assetInfo of assetsInfo) {
      const [assetUtf8Name, assetDatum] = assetInfo;
      const assetHexName = Buffer.from(assetUtf8Name, "utf8").toString("hex");

      try {
        const hasKey = typeof (await db.get(assetUtf8Name)) !== "undefined";
        if (!hasKey) {
          throw new Error(`Asset name is not pre-defined: ${assetUtf8Name}`);
        }

        const mpfProof = await db.prove(assetUtf8Name);
        await db.delete(assetUtf8Name);
        await db.insert(assetUtf8Name, MPT_MINTED_VALUE);
        fulfilment.push([assetHexName, parseMPTProofJSON(mpfProof.toJSON())]);
      } catch (error) {
        return Err(new Error(convertError(error)));
      }

      const refAssetClass = makeAssetClass(
        halPolicyHash,
        `${PREFIX_100}${assetHexName}`
      );
      const userAssetClass = makeAssetClass(
        halPolicyHash,
        `${PREFIX_222}${assetHexName}`
      );

      const refValue = makeValue(1n, makeAssets([[refAssetClass, 1n]]));
      // add user asset into one value.
      userValue.assets = userValue.assets.add(
        makeAssets([[userAssetClass, 1n]])
      );

      refOutputsData.push({
        assetDatum,
        refValue,
      });

      halTokenValue.push(
        [refAssetClass.tokenName, 1n],
        [userAssetClass.tokenName, 1n]
      );
    }
    fulfilments.push(fulfilment);
    mintingHalsData.push({
      orderTxInput,
      destinationAddress,
      refOutputsData,
      userValue,
    });
  }

  // update all handles in minting data
  const newMintingData: MintingData = {
    ...mintingData,
    mpt_root_hash: db.hash.toString("hex"),
  };

  // minting data asset value
  const mintingDataValue = makeValue(
    mintingDataAssetTxInput.value.lovelace,
    mintingDataAssetTxInput.value.assets
  );

  // build redeemer for mint v1 `MintNFTs`
  const mintV1MintHandlesRedeemer = buildMintV1MintHandlesRedeemer();

  // build redeemer for minting data `Mint(Fulfilments)`
  const mintingDataMintRedeemer = buildMintingDataMintRedeemer(fulfilments);

  // prepare order tokens value to collect
  const ordersMintPolicyHash = makeMintingPolicyHash(orders_mint_policy_id);
  const orderTokenAssetClass = makeAssetClass(
    ordersMintPolicyHash,
    ORDER_ASSET_HEX_NAME
  );
  const orderTokensValue = makeValue(
    1n,
    makeAssets([[orderTokenAssetClass, BigInt(decodedOrders.length)]])
  );

  // start building tx
  const txBuilder = makeTxBuilder({
    isMainnet,
  });

  // <-- add required signer
  txBuilder.addSigners(makePubKeyHash(allowed_minter));

  // <-- attach settings asset as reference input
  txBuilder.refer(settingsAssetTxInput);

  // <-- attach deploy scripts
  txBuilder.refer(
    mintProxyScriptTxInput,
    mintV1ScriptTxInput,
    mintingDataScriptTxInput,
    ordersSpendScriptTxInput
  );

  // <-- withdraw from mint v1 withdrawal validator (script from reference input)
  txBuilder.withdrawUnsafe(
    makeStakingAddress(
      isMainnet,
      makeStakingValidatorHash(mintV1ScriptDetails.validatorHash)
    ),
    0n,
    mintV1MintHandlesRedeemer
  );

  // <-- spend minting data utxo
  txBuilder.spendUnsafe(mintingDataAssetTxInput, mintingDataMintRedeemer);

  // <-- lock minting data value with new root hash - mintint_data_output
  txBuilder.payUnsafe(
    mintingDataAssetTxInput.address,
    mintingDataValue,
    makeInlineTxOutputDatum(buildMintingData(newMintingData))
  );

  // <-- collect order nfts to order_nfts_output
  txBuilder.payUnsafe(orderNftsCollector, orderTokensValue);

  // <-- mint hal nfts
  txBuilder.mintPolicyTokensUnsafe(
    halPolicyHash,
    halTokenValue,
    makeVoidData()
  );

  // <-- spend order utxos
  // <-- send minted HALs to destination with datum
  const ordersSpendExecuteOrdersRedeemer =
    buildOrdersSpendExecuteOrdersRedeemer();

  for (const mintingHalData of mintingHalsData) {
    const { orderTxInput, destinationAddress, refOutputsData, userValue } =
      mintingHalData;

    // <-- spend order UTxO
    txBuilder.spendUnsafe(orderTxInput, ordersSpendExecuteOrdersRedeemer);

    // <-- pay ref outputs
    for (const refOutputData of refOutputsData) {
      const { refValue, assetDatum } = refOutputData;
      txBuilder.payUnsafe(ref_spend_script_address, refValue, assetDatum);
    }

    // <-- pay user output
    txBuilder.payUnsafe(destinationAddress, userValue);
  }

  return Ok({
    txBuilder,
    settings,
    settingsV1,
    totalPrice,
  });
};

/**
 * @interface
 * @typedef {object} RollBackOrdersFromTrieParams
 * @property {Order[]} orders Orders
 * @property {Trie} db Trie DB
 */
interface RollBackOrdersFromTrieParams {
  orders: Order[];
  db: Trie;
}

/**
 * @description Roll Back Orders from Trie after minting is failed
 * @param {RollBackOrdersFromTrieParams} params
 * @returns {Promise<Result<void,  Error>>} Result or Error
 */
const rollBackOrdersFromTrie = async (
  params: RollBackOrdersFromTrieParams
): Promise<Result<void, Error>> => {
  const { orders, db } = params;

  for (const order of orders) {
    const { assetsInfo } = order;
    for (const assetInfo of assetsInfo) {
      try {
        const value = await db.get(assetInfo[0]);
        const needRollback =
          typeof value !== "undefined" &&
          Buffer.from(value).toString() === MPT_MINTED_VALUE;
        if (needRollback) {
          await db.delete(assetInfo[0]);
          await db.insert(assetInfo[0], "");
        }
      } catch (error) {
        return Err(
          new Error(
            `Failed to roll back "${assetInfo[0]}" : ${convertError(error)}`
          )
        );
      }
    }
  }
  return Ok();
};

export type { PrepareMintParams, RollBackOrdersFromTrieParams };
export { prepareMintTransaction, rollBackOrdersFromTrie };
