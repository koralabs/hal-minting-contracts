import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { ByteArrayLike, IntLike } from "@helios-lang/codec-utils";
import {
  Address,
  makeAssetClass,
  makeAssets,
  makeInlineTxOutputDatum,
  makeMintingPolicyHash,
  makeTxOutput,
  makeValidatorHash,
  makeValue,
  TxOutput,
} from "@helios-lang/ledger";
import { NetworkName, TxBuilder } from "@helios-lang/tx-utils";
import { Err, Ok, Result } from "ts-res";

import {
  MAX_TRANSACTION_FEE,
  ORDER_ASSET_HEX_NAME,
  PREFIX_100,
  PREFIX_222,
} from "../constants/index.js";
import {
  buildOrdersMintExecuteOrdersRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  decodeOrderDatum,
  makeVoidData,
} from "../contracts/index.js";
import { fetchNetworkParameters } from "../utils/index.js";
import { DeployedScripts } from "./deploy.js";
import { isValidOrderTxInput } from "./order.js";
import { prepareMintTransaction } from "./prepareMint.js";
import { Order, OrderedAsset } from "./types.js";

/**
 * @interface
 * @typedef {object} MintParams
 * @property {NetworkName} network Network
 * @property {Address} address Wallet Address to perform mint
 * @property {Order[]} orders Order Tx Inputs and asset names to mint
 * @property {Trie} db Trie DB
 * @property {string} blockfrostApiKey Blockfrost API Key
 * @property {DeployedScripts} deployedScripts Deployed Scripts
 */
interface MintParams {
  network: NetworkName;
  address: Address;
  orders: Order[];
  db: Trie;
  deployedScripts: DeployedScripts;
}

/**
 * @description Mint Handles from Order (only new handles)
 * @param {MintParams} params
 * @returns {Promise<Result<TxBuilder,  Error>>} Transaction Result
 */
const mint = async (params: MintParams): Promise<Result<TxBuilder, Error>> => {
  const { network, orders, deployedScripts } = params;

  // refactor Orders Tx Inputs
  // NOTE:
  // sort orderUtxos before process
  // because tx inputs is sorted lexicographically
  // we have to insert handle in same order as tx inputs
  orders
    .sort((a, b) =>
      a.orderTxInput.id.toString() > b.orderTxInput.id.toString() ? 1 : -1
    )
    .reverse();
  if (orders.length == 0) return Err(new Error("No Order requested"));
  console.log(`${orders.length} Orders are picked`);

  const orderedAssets: OrderedAsset[] = orders.map((order) => {
    const { orderTxInput, assetUtf8Name } = order;
    const decodedOrder = decodeOrderDatum(orderTxInput.datum, network);
    const { destination_address, price } = decodedOrder;
    return {
      utf8Name: assetUtf8Name,
      hexName: Buffer.from(assetUtf8Name, "utf8").toString("hex"),
      destinationAddress: destination_address,
      price,
    };
  });

  // fetch network params
  const networkParamsResult = await fetchNetworkParameters(network);
  if (!networkParamsResult.ok) {
    return Err(
      new Error(`Failed to fetch Network Params: ${networkParamsResult.error}`)
    );
  }
  const networkParams = networkParamsResult.data;

  const preparedTxBuilderResult = await prepareMintTransaction({
    ...params,
    orderedAssets,
  });

  if (!preparedTxBuilderResult.ok) {
    return Err(
      new Error(
        `Failed to prepare New Mint Transaction: ${preparedTxBuilderResult.error}`
      )
    );
  }
  const { txBuilder, settingsV1, totalHalPrice } = preparedTxBuilderResult.data;
  const {
    mintProxyScriptDetails,
    ordersSpendScriptDetails,
    ordersMintScriptDetails,
  } = deployedScripts;
  const halPolicyHash = makeMintingPolicyHash(
    mintProxyScriptDetails.validatorHash
  );

  const mintingHandlesData = [];
  for (const order of orders) {
    const { orderTxInput, assetUtf8Name, assetDatum } = order;
    const decodedOrder = decodeOrderDatum(orderTxInput.datum, network);
    const { destination_address } = decodedOrder;
    const assetHexName = Buffer.from(assetUtf8Name, "utf8").toString("hex");

    const refHandleAssetClass = makeAssetClass(
      halPolicyHash,
      `${PREFIX_100}${assetHexName}`
    );
    const userHandleAssetClass = makeAssetClass(
      halPolicyHash,
      `${PREFIX_222}${assetHexName}`
    );

    // check is order input is valid
    const isValidOrderInput = isValidOrderTxInput({
      network,
      orderTxInput,
      ordersSpendScriptDetails,
    });
    if (!isValidOrderInput.ok) {
      return Err(
        new Error(`Order Input is invalid: ${isValidOrderInput.error}`)
      );
    }

    const refHandleValue = makeValue(
      1n,
      makeAssets([[refHandleAssetClass, 1n]])
    );
    const userHandleValue = makeValue(
      1n,
      makeAssets([[userHandleAssetClass, 1n]])
    );
    const destinationAddress = destination_address;

    mintingHandlesData.push({
      orderTxInput,
      destinationAddress,
      assetDatum,
      refHandleValue,
      userHandleValue,
      refHandleAssetClass,
      userHandleAssetClass,
    });
  }

  // continue transaction building
  // from prepareMintTransaction

  // prepare hal nfts token value
  const halTokenValue: [ByteArrayLike, IntLike][] = [];
  mintingHandlesData.forEach((mintingHandle) => {
    const { refHandleAssetClass, userHandleAssetClass } = mintingHandle;
    halTokenValue.push(
      [refHandleAssetClass.tokenName, 1n],
      [userHandleAssetClass.tokenName, 1n]
    );
  });

  // prepare order nfts token value
  const ordersMintPolicyHash = makeMintingPolicyHash(
    makeValidatorHash(ordersMintScriptDetails.validatorHash)
  );
  const orderTokenAssetClass = makeAssetClass(
    ordersMintPolicyHash,
    ORDER_ASSET_HEX_NAME
  );
  // burn orders NFT same amount as orders length
  const orderTokenValue: [ByteArrayLike, IntLike][] = [
    [orderTokenAssetClass.tokenName, BigInt(-orders.length)],
  ];

  // build redeemer for orders_mint `ExecuteOrders`
  const ordersMintExecuteOrdersRedeemer =
    buildOrdersMintExecuteOrdersRedeemer();

  // build redeemer for orders_spend `ExecuteOrders`
  const ordersSpendExecuteOrdersRedeemer =
    buildOrdersSpendExecuteOrdersRedeemer();

  // <-- mint hal nfts
  txBuilder.mintPolicyTokensUnsafe(
    halPolicyHash,
    halTokenValue,
    makeVoidData()
  );

  // <-- burn order nfts
  txBuilder.mintPolicyTokensUnsafe(
    ordersMintPolicyHash,
    orderTokenValue,
    ordersMintExecuteOrdersRedeemer
  );

  // <-- spend order utxos and mint handle
  // and send minted handle to destination with datum
  let totalMinLovelace: bigint = 0n;
  const halNftOutputs: TxOutput[] = [];
  for (const mintingHandle of mintingHandlesData) {
    const {
      orderTxInput,
      refHandleValue,
      userHandleValue,
      destinationAddress,
      assetDatum,
    } = mintingHandle;

    const refOutput = makeTxOutput(
      settingsV1.ref_spend_script_address,
      refHandleValue,
      assetDatum
    );
    refOutput.correctLovelace(networkParams);
    const userOutput = makeTxOutput(destinationAddress, userHandleValue);
    userOutput.correctLovelace(networkParams);
    totalMinLovelace += refOutput.value.lovelace + userOutput.value.lovelace;
    halNftOutputs.push(refOutput, userOutput);

    txBuilder.spendUnsafe(orderTxInput, ordersSpendExecuteOrdersRedeemer);
  }

  // insert payment output as second output
  const requiredPaymentLovelace =
    totalHalPrice - totalMinLovelace - MAX_TRANSACTION_FEE;
  const paymentOutput = makeTxOutput(
    settingsV1.payment_address,
    makeValue(requiredPaymentLovelace),
    makeInlineTxOutputDatum(makeVoidData())
  );
  txBuilder.addOutput(paymentOutput, ...halNftOutputs);

  return Ok(txBuilder);
};

export type { MintParams };
export { mint };
