import { IntLike } from "@helios-lang/codec-utils";
import { ByteArrayLike } from "@helios-lang/codec-utils";
import {
  Address,
  makeAddress,
  makeAssetClass,
  makeAssets,
  makeInlineTxOutputDatum,
  makeMintingPolicyHash,
  makePubKeyHash,
  makeValidatorHash,
  makeValue,
  TxInput,
} from "@helios-lang/ledger";
import { makeTxBuilder, NetworkName, TxBuilder } from "@helios-lang/tx-utils";
import { ScriptDetails } from "@koralabs/kora-labs-common";
import { Err, Ok, Result } from "ts-res";

import { fetchSettings } from "../configs/index.js";
import { HAL_NFT_PRICE, ORDER_ASSET_HEX_NAME } from "../constants/index.js";
import {
  buildOrderData,
  buildOrdersMintBurnOrdersRedeemer,
  buildOrdersMintMintOrderRedeemer,
  buildOrdersSpendCancelOrderRedeemer,
  decodeOrderDatum,
  OrderDatum,
} from "../contracts/index.js";
import {
  getBlockfrostV0Client,
  getNetwork,
  mayFail,
  mayFailAsync,
} from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";

/**
 * @interface
 * @typedef {object} RequestParams
 * @property {NetworkName} network Network
 * @property {Address} address User's Wallet Address to perform order
 * @property {number} amount Amount of H.A.L. NFTs to order
 * @property {DeployedScripts} deployedScripts Deployed Scripts
 */
interface RequestParams {
  network: NetworkName;
  address: Address;
  amount: number;
  deployedScripts: DeployedScripts;
}

/**
 * @description Request asset to be minted
 * @param {RequestParams} params
 * @returns {Promise<Result<TxBuilder,  Error>>} Transaction Result
 */
const request = async (
  params: RequestParams
): Promise<Result<TxBuilder, Error>> => {
  const { network, address, amount, deployedScripts } = params;
  const isMainnet = network == "mainnet";
  if (address.era == "Byron")
    return Err(new Error("Byron Address not supported"));
  if (address.spendingCredential.kind == "ValidatorHash")
    return Err(new Error("Must be Base address"));

  if (amount <= 0n) {
    return Err(new Error("Amount must be greater than 0"));
  }

  const {
    ordersMintScriptTxInput,
    ordersMintScriptDetails,
    ordersSpendScriptDetails,
  } = deployedScripts;

  // fetch settings
  const settingsResult = await fetchSettings(network);
  if (!settingsResult.ok)
    return Err(new Error(`Failed to fetch settings: ${settingsResult.error}`));
  const { settingsAssetTxInput, settingsV1 } = settingsResult.data;
  const { orders_minter, max_order_amount } = settingsV1;

  // check amount is not greater than max_order_amount
  if (amount > max_order_amount) {
    return Err(
      new Error(
        `Amount must be less than or equal to ${max_order_amount} (max_order_amount)`
      )
    );
  }

  // orders spend script address
  const ordersSpendScriptAddress = makeAddress(
    isMainnet,
    makeValidatorHash(ordersSpendScriptDetails.validatorHash)
  );

  // order token policy id
  const ordersMintPolicyHash = makeMintingPolicyHash(
    makeValidatorHash(ordersMintScriptDetails.validatorHash)
  );

  const order: OrderDatum = {
    owner_key_hash: address.spendingCredential.toHex(),
    price: HAL_NFT_PRICE,
    destination_address: address,
    amount,
  };

  // order value
  const orderTokenAssetClass = makeAssetClass(
    ordersMintPolicyHash,
    ORDER_ASSET_HEX_NAME
  );
  const orderTokenValue: [ByteArrayLike, IntLike][] = [
    [orderTokenAssetClass.tokenName, 1n],
  ];
  const orderValue = makeValue(
    HAL_NFT_PRICE * BigInt(amount),
    makeAssets([[orderTokenAssetClass, 1n]])
  );

  // start building tx
  const txBuilder = makeTxBuilder({
    isMainnet,
  });

  // <-- attach settings asset as reference input
  txBuilder.refer(settingsAssetTxInput);

  // <-- add orders_minter signer
  txBuilder.addSigners(makePubKeyHash(orders_minter));

  // <-- attach orders mint script
  txBuilder.refer(ordersMintScriptTxInput);

  // <-- mint order token
  txBuilder.mintPolicyTokensUnsafe(
    ordersMintPolicyHash,
    orderTokenValue,
    buildOrdersMintMintOrderRedeemer(address, amount)
  );

  // <-- pay order value to order spend script adress
  txBuilder.payUnsafe(
    ordersSpendScriptAddress,
    orderValue,
    makeInlineTxOutputDatum(buildOrderData(order))
  );

  return Ok(txBuilder);
};

/**
 * @interface
 * @typedef {object} CancelParams
 * @property {NetworkName} network Network
 * @property {Address} address User's Wallet Address to perform order
 * @property {TxInput} orderTxInput Order Tx Input
 * @property {DeployedScripts} deployedScripts Deployed Scripts
 */
interface CancelParams {
  network: NetworkName;
  address: Address;
  orderTxInput: TxInput;
  deployedScripts: DeployedScripts;
}

/**
 * @description Request handle to be minted
 * @param {CancelParams} params
 * @returns {Promise<Result<TxBuilder,  Error>>} Transaction Result
 */
const cancel = async (
  params: CancelParams
): Promise<Result<TxBuilder, Error>> => {
  const { network, address, orderTxInput, deployedScripts } = params;
  const isMainnet = network == "mainnet";
  if (address.era == "Byron")
    return Err(new Error("Byron Address not supported"));
  if (address.spendingCredential.kind == "ValidatorHash")
    return Err(new Error("Must be Base address"));

  const {
    ordersMintScriptTxInput,
    ordersMintScriptDetails,
    ordersSpendScriptTxInput,
    ordersSpendScriptDetails,
  } = deployedScripts;

  // check if order tx input is from ordersSpendScriptAddress
  const ordersSpendScriptAddress = makeAddress(
    isMainnet,
    makeValidatorHash(ordersSpendScriptDetails.validatorHash)
  );
  if (!orderTxInput.address.isEqual(ordersSpendScriptAddress)) {
    return Err(
      new Error("Order Tx Input must be from Orders Spend Script Address")
    );
  }

  // order token policy id
  const ordersMintPolicyHash = makeMintingPolicyHash(
    makeValidatorHash(ordersMintScriptDetails.validatorHash)
  );

  // order value
  const orderTokenAssetClass = makeAssetClass(
    ordersMintPolicyHash,
    ORDER_ASSET_HEX_NAME
  );
  const orderTokenValue: [ByteArrayLike, IntLike][] = [
    [orderTokenAssetClass.tokenName, -1n],
  ];

  // start building tx
  const txBuilder = makeTxBuilder({
    isMainnet,
  });

  // <-- attach orders spend and mint scripts
  txBuilder.refer(ordersMintScriptTxInput, ordersSpendScriptTxInput);

  // <-- spend order tx input
  txBuilder.spendUnsafe(orderTxInput, buildOrdersSpendCancelOrderRedeemer());

  // <-- burn order token value
  txBuilder.mintPolicyTokensUnsafe(
    ordersMintPolicyHash,
    orderTokenValue,
    buildOrdersMintBurnOrdersRedeemer()
  );

  // <-- add signer
  txBuilder.addSigners(address.spendingCredential);

  return Ok(txBuilder);
};

/**
 * @interface
 * @typedef {object} FetchOrdersTxInputsParams
 * @property {ScriptDetails} ordersSpendScriptDetails Deployed Orders Spend Script Detail
 * @property {string} blockfrostApiKey Blockfrost API Key
 */
interface FetchOrdersTxInputsParams {
  ordersSpendScriptDetails: ScriptDetails;
  blockfrostApiKey: string;
}

/**
 * @description Fetch Orders UTxOs
 * @param {FetchOrdersTxInputsParams} params
 * @returns {Promise<Result<TxInput[], Error>>} Transaction Result
 */
const fetchOrdersTxInputs = async (
  params: FetchOrdersTxInputsParams
): Promise<Result<TxInput[], Error>> => {
  const { ordersSpendScriptDetails, blockfrostApiKey } = params;
  const network = getNetwork(blockfrostApiKey);
  const isMainnet = network == "mainnet";
  const blockfrostV0Client = getBlockfrostV0Client(blockfrostApiKey);

  const ordersSpendScriptAddress = makeAddress(
    isMainnet,
    makeValidatorHash(ordersSpendScriptDetails.validatorHash)
  );

  // fetch order utxos
  const orderUtxosResult = await mayFailAsync(() =>
    blockfrostV0Client.getUtxos(ordersSpendScriptAddress)
  ).complete();
  if (!orderUtxosResult.ok)
    return Err(
      new Error(`Failed to fetch order UTxOs: ${orderUtxosResult.error}`)
    );

  // remove invalid order utxos
  const orderUtxos = orderUtxosResult.data.filter((utxo) => {
    const decodedResult = mayFail(() => decodeOrderDatum(utxo.datum, network));
    return decodedResult.ok;
  });

  return Ok(orderUtxos);
};

/**
 * @interface
 * @typedef {object} IsValidOrderTxInputParams
 * @property {NetworkName} network Network
 * @property {TxInput} orderTxInput Order TxInput
 * @property {Address} ordersSpendScriptAddress Orders Spend Script Address
 * @property {number} maxOrderAmount max_order_amount from Settings
 */
interface IsValidOrderTxInputParams {
  network: NetworkName;
  orderTxInput: TxInput;
  ordersSpendScriptDetails: ScriptDetails;
  maxOrderAmount: number;
}

/**
 * @description Check TxInput is valid order UTxO
 * @param {IsValidOrderTxInputParams} params
 * @returns {boolean} True if valid order UTxO, false otherwise
 */
const isValidOrderTxInput = (
  params: IsValidOrderTxInputParams
): Result<true, Error> => {
  const { network, orderTxInput, ordersSpendScriptDetails, maxOrderAmount } =
    params;
  const isMainnet = network == "mainnet";
  const ordersSpendScriptAddress = makeAddress(
    isMainnet,
    makeValidatorHash(ordersSpendScriptDetails.validatorHash)
  );

  // check if address matches
  if (!orderTxInput.address.isEqual(ordersSpendScriptAddress)) {
    return Err(
      new Error("Order TxInput must be from Orders Spend Script Address")
    );
  }

  // check if datum is valid
  const decodedResult = mayFail(() =>
    decodeOrderDatum(orderTxInput.datum, network)
  );
  if (!decodedResult.ok) {
    return Err(new Error("Invalid Order Datum"));
  }
  const { amount } = decodedResult.data;

  // check amount
  if (amount > maxOrderAmount) {
    return Err(
      new Error(
        `Amount must be less than or equal to ${maxOrderAmount} (max_order_amount)`
      )
    );
  }

  // check lovelace is enough
  const expectedLovelace = BigInt(amount) * HAL_NFT_PRICE;
  if (orderTxInput.value.lovelace < expectedLovelace) {
    return Err(new Error("Insufficient Lovelace"));
  }

  return Ok(true);
};

export type {
  CancelParams,
  FetchOrdersTxInputsParams,
  IsValidOrderTxInputParams,
  RequestParams,
};
export { cancel, fetchOrdersTxInputs, isValidOrderTxInput, request };
