import { Err, Ok, Result } from "ts-res";

import {
  constr,
  expectConstr,
  expectInt,
  expectList,
  fromCbor,
  int,
  list,
  PlutusData,
} from "../../cardano/index.js";
import { convertError } from "../../helpers/index.js";
import { WhitelistedItem, WhitelistedValue } from "../types/whitelist.js";

const decodeWhitelistedValueFromCBOR = (
  value: Buffer | Uint8Array | string
): Result<WhitelistedValue, Error> => {
  try {
    const cbor = typeof value === "string" ? value : Buffer.from(value).toString("hex");
    return Ok(expectList(fromCbor(cbor), "whitelisted_value").map(decodeWhitelistedItem));
  } catch (error) {
    return Err(new Error(`Failed to decode whitelisted item: ${convertError(error)}`));
  }
};

const decodeWhitelistedItem = (data: PlutusData): WhitelistedItem => {
  const { fields } = expectConstr(data, "WhitelistedItem", 0, 3);
  return {
    time_gap: Number(expectInt(fields[0], "time_gap")),
    amount: Number(expectInt(fields[1], "amount")),
    price: expectInt(fields[2], "price"),
  };
};

const makeWhitelistedValueData = (whitelistedValue: WhitelistedValue): PlutusData =>
  list(whitelistedValue.map(makeWhitelistedItemData));

const makeWhitelistedItemData = ({ time_gap, amount, price }: WhitelistedItem): PlutusData =>
  constr(0, [int(time_gap), int(amount), int(price)]);

export {
  decodeWhitelistedItem,
  decodeWhitelistedValueFromCBOR,
  makeWhitelistedItemData,
  makeWhitelistedValueData,
};
