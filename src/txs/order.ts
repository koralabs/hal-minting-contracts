import type { BlockfrostTxClient } from "@koralabs/kora-labs-common/txBuild";
import { ScriptDetails } from "@koralabs/kora-labs-common";
import { Err, Ok, Result } from "ts-res";

import {
  Cardano,
  inlineDatumOf,
  paymentCredentialOf,
  scriptAddress,
  Utxo,
  utxoRef,
} from "../cardano/index.js";
import { MAX_ORDER_UTXOS_IN_ONE_TX } from "../constants/index.js";
import {
  buildOrderDatumData,
  buildOrdersSpendCancelOrderRedeemer,
  buildOrdersSpendRefundOrderRedeemer,
  decodeOrderDatumData,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  OrderDatum,
  Settings,
  SettingsV1,
} from "../contracts/index.js";
import { mayFail, mayFailAsync } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";
import { HalTxPlan, referTo } from "./plan.js";
import { Order } from "./types.js";

const isKeyAddress = (bech32: string) => {
  try {
    return paymentCredentialOf(bech32).type === Cardano.CredentialType.KeyHash;
  } catch {
    return false;
  }
};

interface RequestParams {
  isMainnet: boolean;
  orders: Order[];
  settings: Settings;
  maxOrderAmountInOneTx: number;
}

/**
 * @description Request H.A.L. NFTs: one order UTxO (with its OrderDatum) per order, at the orders
 * validator. No script runs; the wallet pays.
 */
const request = async (params: RequestParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, orders, settings, maxOrderAmountInOneTx } = params;

  for (const { destinationAddress, amount } of orders) {
    if (!isKeyAddress(destinationAddress)) return Err(new Error("Must be Base address"));
    if (amount <= 0) return Err(new Error("Amount must be greater than 0"));
    if (amount > maxOrderAmountInOneTx) {
      return Err(new Error(`Order amount must be less than or equal to ${maxOrderAmountInOneTx}`));
    }
  }
  if (orders.length > MAX_ORDER_UTXOS_IN_ONE_TX) {
    return Err(
      new Error(`Can request Orders less than or equal to ${MAX_ORDER_UTXOS_IN_ONE_TX} in one transaction`)
    );
  }

  const settingsV1Result = mayFail(() => decodeSettingsV1Data(settings.data, isMainnet));
  if (!settingsV1Result.ok) {
    return Err(new Error(`Failed to decode settings v1: ${settingsV1Result.error}`));
  }
  const ordersSpendScriptAddress = scriptAddress(
    settingsV1Result.data.orders_spend_script_hash,
    isMainnet
  ) as Cardano.PaymentAddress;

  return Ok({
    inputs: [],
    outputs: orders.map(({ destinationAddress, amount, cost }) => {
      const orderDatum: OrderDatum = {
        owner_key_hash: paymentCredentialOf(destinationAddress).hash,
        destination_address: destinationAddress,
        amount,
      };
      return {
        address: ordersSpendScriptAddress,
        value: { coins: cost },
        datum: buildOrderDatumData(orderDatum).toCore(),
      };
    }),
    plutusLanguages: [],
    referenceScriptBytes: 0,
  });
};

interface CancelParams {
  isMainnet: boolean;
  /** bech32 of the canceller (must be a key address). */
  address: string;
  orderTxInput: Utxo;
  deployedScripts: DeployedScripts;
}

/**
 * @description Cancel an order: the owner (the datum's owner_key_hash) signs; the order's value
 * goes to the change address.
 */
const cancel = async (params: CancelParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, address, orderTxInput, deployedScripts } = params;
  if (!isKeyAddress(address)) return Err(new Error("Must be Base address"));

  const { ordersSpendScriptTxInput, ordersSpendScriptDetails } = deployedScripts;
  if (orderTxInput[1].address !== scriptAddress(ordersSpendScriptDetails.validatorHash, isMainnet)) {
    return Err(new Error("Order Tx Input must be from Orders Spend Script Address"));
  }

  const orderDatumResult = mayFail(() =>
    decodeOrderDatumData(inlineDatumOf(orderTxInput), isMainnet)
  );
  if (!orderDatumResult.ok) {
    return Err(new Error(`Order Tx Input datum is invalid: ${orderDatumResult.error}`));
  }

  return Ok({
    inputs: [{ utxo: orderTxInput, redeemer: buildOrdersSpendCancelOrderRedeemer() }],
    outputs: [],
    requiredSigners: [orderDatumResult.data.owner_key_hash],
    ...referTo([ordersSpendScriptTxInput]),
  });
};

interface RefundParams {
  isMainnet: boolean;
  orderTxInput: Utxo;
  /** bech32; must carry the order owner's payment key when the order datum decodes. */
  refundingAddress: string;
  deployedScripts: DeployedScripts;
  settingsAssetTxInput: Utxo;
}

/**
 * @description Refund an order UTxO (allowed minter signs). Pass `refundingAddress` as the
 * change address to `completeTx`: everything but the fee goes back to the owner.
 */
const refund = async (params: RefundParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, orderTxInput, refundingAddress, deployedScripts, settingsAssetTxInput } =
    params;
  const { ordersSpendScriptTxInput, ordersSpendScriptDetails } = deployedScripts;

  const settingsResult = mayFail(() => decodeSettingsDatum(inlineDatumOf(settingsAssetTxInput)));
  if (!settingsResult.ok) {
    return Err(new Error(`Failed to decode settings: ${settingsResult.error}`));
  }
  const settingsV1Result = mayFail(() =>
    decodeSettingsV1Data(settingsResult.data.data, isMainnet)
  );
  if (!settingsV1Result.ok) {
    return Err(new Error(`Failed to decode settings v1: ${settingsV1Result.error}`));
  }
  const { allowed_minter } = settingsV1Result.data;

  if (orderTxInput[1].address !== scriptAddress(ordersSpendScriptDetails.validatorHash, isMainnet)) {
    return Err(new Error("Order Tx Input must be from Orders Spend Script Address"));
  }

  const decodedOrderDatum = mayFail(() =>
    decodeOrderDatumData(inlineDatumOf(orderTxInput), isMainnet)
  );
  if (decodedOrderDatum.ok) {
    const ownerKeyHash = decodedOrderDatum.data.owner_key_hash;
    if (paymentCredentialOf(refundingAddress).hash.toLowerCase() !== ownerKeyHash.toLowerCase()) {
      return Err(
        new Error(
          `Order Tx Input ${utxoRef(orderTxInput)} must be refunded to "${ownerKeyHash}" payment credential`
        )
      );
    }
  }

  return Ok({
    inputs: [{ utxo: orderTxInput, redeemer: buildOrdersSpendRefundOrderRedeemer() }],
    outputs: [],
    requiredSigners: [allowed_minter],
    ...referTo([settingsAssetTxInput, ordersSpendScriptTxInput]),
  });
};

interface FetchOrderTxInputsParams {
  isMainnet: boolean;
  blockfrost: Pick<BlockfrostTxClient, "getAddressUtxos">;
  ordersSpendScriptDetails: ScriptDetails;
}

/**
 * @description Fetch Order UTxOs
 */
const fetchOrderTxInputs = async (
  params: FetchOrderTxInputsParams
): Promise<Result<Utxo[], Error>> => {
  const { isMainnet, blockfrost, ordersSpendScriptDetails } = params;
  const orderUtxosResult = await mayFailAsync(() =>
    blockfrost.getAddressUtxos(scriptAddress(ordersSpendScriptDetails.validatorHash, isMainnet))
  ).complete();
  if (!orderUtxosResult.ok)
    return Err(new Error(`Failed to fetch order UTxOs: ${orderUtxosResult.error}`));
  return Ok(orderUtxosResult.data);
};

interface IsOrderTxInputValidParams {
  isMainnet: boolean;
  orderTxInput: Utxo;
  settingsV1: SettingsV1;
  maxOrderAmountInOneTx: number;
}

/**
 * @description Is `orderTxInput` a processable order: at the (stake-less) orders validator address,
 * with a decodable, non-zero, in-range datum.
 */
const isOrderTxInputValid = (params: IsOrderTxInputValidParams): Result<true, Error> => {
  const { isMainnet, orderTxInput, settingsV1, maxOrderAmountInOneTx } = params;
  if (orderTxInput[1].address !== scriptAddress(settingsV1.orders_spend_script_hash, isMainnet)) {
    return Err(new Error("Order TxInput must be from Orders Spend Script Address"));
  }
  const decodedResult = mayFail(() => decodeOrderDatumData(inlineDatumOf(orderTxInput), isMainnet));
  if (!decodedResult.ok) return Err(new Error(`Invalid Order Datum: ${decodedResult.error}`));
  const { amount } = decodedResult.data;
  if (amount > maxOrderAmountInOneTx) {
    return Err(
      new Error(`Order Tx Input has too many amount ${amount}. maximum: ${maxOrderAmountInOneTx}`)
    );
  }
  if (amount === 0) return Err(new Error("Order TxInput has 0 amount"));
  return Ok(true);
};

export type {
  CancelParams,
  FetchOrderTxInputsParams,
  IsOrderTxInputValidParams,
  RefundParams,
  RequestParams,
};
export { cancel, fetchOrderTxInputs, isOrderTxInputValid, refund, request };
