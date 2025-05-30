import { ShelleyAddress } from "@helios-lang/ledger";
import { NetworkName } from "@helios-lang/tx-utils";
import {
  expectByteArrayData,
  expectConstrData,
  expectIntData,
  makeByteArrayData,
  makeConstrData,
  makeIntData,
  UplcData,
} from "@helios-lang/uplc";

import { SettingsV1 } from "../types/index.js";
import { buildAddressData, decodeAddressFromData } from "./common.js";

const buildSettingsV1Data = (settings: SettingsV1): UplcData => {
  const {
    policy_id,
    allowed_minter,
    hal_nft_price,
    payment_address,
    ref_spend_script_address,
    orders_spend_script_address,
    orders_mint_policy_id,
    minting_data_script_hash,
    orders_minter,
    ref_spend_admin,
    max_order_amount,
  } = settings;

  return makeConstrData(0, [
    makeByteArrayData(policy_id),
    makeByteArrayData(allowed_minter),
    makeIntData(hal_nft_price),
    buildAddressData(payment_address as ShelleyAddress),
    buildAddressData(ref_spend_script_address as ShelleyAddress),
    buildAddressData(orders_spend_script_address as ShelleyAddress),
    makeByteArrayData(orders_mint_policy_id),
    makeByteArrayData(minting_data_script_hash),
    makeByteArrayData(orders_minter),
    makeByteArrayData(ref_spend_admin),
    makeIntData(max_order_amount),
  ]);
};

const decodeSettingsV1Data = (
  data: UplcData,
  network: NetworkName
): SettingsV1 => {
  const settingsV1ConstrData = expectConstrData(data, 0, 11);

  const policy_id = expectByteArrayData(
    settingsV1ConstrData.fields[0],
    "policy_id must be ByteArray"
  ).toHex();

  // allowed_minters
  const allowed_minter = expectByteArrayData(
    settingsV1ConstrData.fields[1],
    "allowed_minter must be ByteArray"
  ).toHex();

  // hal_nft_price
  const hal_nft_price = expectIntData(
    settingsV1ConstrData.fields[2],
    "hal_nft_price must be Int"
  ).value;

  // payment_address
  const payment_address = decodeAddressFromData(
    settingsV1ConstrData.fields[3],
    network
  );

  // ref_spend_script_address
  const ref_spend_script_address = decodeAddressFromData(
    settingsV1ConstrData.fields[4],
    network
  );

  // orders_spend_script_address
  const orders_spend_script_address = decodeAddressFromData(
    settingsV1ConstrData.fields[5],
    network
  );

  // orders_mint_policy_id
  const orders_mint_policy_id = expectByteArrayData(
    settingsV1ConstrData.fields[6],
    "orders_mint_policy_id must be ByteArray"
  ).toHex();

  // minting_data_script_hash
  const minting_data_script_hash = expectByteArrayData(
    settingsV1ConstrData.fields[7],
    "minting_data_script_hash must be ByteArray"
  ).toHex();

  // orders_minter
  const orders_minter = expectByteArrayData(
    settingsV1ConstrData.fields[8],
    "orders_minter must be ByteArray"
  ).toHex();

  // ref_spend_admin
  const ref_spend_admin = expectByteArrayData(
    settingsV1ConstrData.fields[9],
    "ref_spend_admin must be ByteArray"
  ).toHex();

  // max_order_amount
  const max_order_amount = Number(
    expectIntData(
      settingsV1ConstrData.fields[10],
      "max_order_amount must be Int"
    ).value
  );

  return {
    policy_id,
    allowed_minter,
    hal_nft_price,
    payment_address,
    ref_spend_script_address,
    orders_spend_script_address,
    orders_mint_policy_id,
    minting_data_script_hash,
    orders_minter,
    ref_spend_admin,
    max_order_amount,
  };
};

export { buildSettingsV1Data, decodeSettingsV1Data };
