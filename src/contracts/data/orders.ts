import {
  bytes,
  constr,
  expectBytes,
  expectConstr,
  expectInt,
  int,
  PlutusData,
} from "../../cardano/index.js";
import { invariant } from "../../helpers/index.js";
import { OrderDatum } from "../types/index.js";
import { buildAddressData, decodeAddressFromData } from "./common.js";

/** `datum` is the order UTxO's inline datum (undefined when it has none). */
const decodeOrderDatumData = (
  datum: PlutusData | undefined,
  isMainnet: boolean
): OrderDatum => {
  invariant(datum, "OrderDatum must be inline datum");
  const { fields } = expectConstr(datum, "OrderDatum", 0, 3);
  return {
    owner_key_hash: expectBytes(fields[0], "owner_key_hash"),
    destination_address: decodeAddressFromData(fields[1], isMainnet),
    amount: Number(expectInt(fields[2], "amount")),
  };
};

const buildOrderDatumData = (order: OrderDatum): PlutusData => {
  const { owner_key_hash, destination_address, amount } = order;
  return constr(0, [
    bytes(owner_key_hash),
    buildAddressData(destination_address),
    int(amount),
  ]);
};

const buildOrdersSpendExecuteOrdersRedeemer = (): PlutusData => constr(0);

const buildOrdersSpendCancelOrderRedeemer = (): PlutusData => constr(1);

const buildOrdersSpendRefundOrderRedeemer = (): PlutusData => constr(2);

export {
  buildOrderDatumData,
  buildOrdersSpendCancelOrderRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  buildOrdersSpendRefundOrderRedeemer,
  decodeOrderDatumData,
};
