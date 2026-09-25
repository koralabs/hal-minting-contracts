import {
  bytes,
  constr,
  expectBytes,
  expectConstr,
  expectInt,
  int,
  PlutusData,
} from "../../cardano/index.js";
import { RefSpendSettingsV1, SettingsV1 } from "../types/index.js";
import { buildAddressData, decodeAddressFromData } from "./common.js";

const buildSettingsV1Data = (settings: SettingsV1): PlutusData =>
  constr(0, [
    bytes(settings.policy_id),
    bytes(settings.allowed_minter),
    int(settings.hal_nft_price),
    bytes(settings.minting_data_script_hash),
    bytes(settings.orders_spend_script_hash),
    bytes(settings.ref_spend_proxy_script_hash),
    bytes(settings.ref_spend_governor),
    bytes(settings.ref_spend_admin),
    bytes(settings.royalty_spend_script_hash),
    int(settings.minting_start_time),
    buildAddressData(settings.payment_address),
  ]);

const decodeSettingsV1Data = (
  data: PlutusData,
  isMainnet: boolean
): SettingsV1 => {
  const { fields } = expectConstr(data, "SettingsV1", 0, 11);
  return {
    policy_id: expectBytes(fields[0], "policy_id"),
    allowed_minter: expectBytes(fields[1], "allowed_minter"),
    hal_nft_price: expectInt(fields[2], "hal_nft_price"),
    minting_data_script_hash: expectBytes(fields[3], "minting_data_script_hash"),
    orders_spend_script_hash: expectBytes(fields[4], "orders_spend_script_hash"),
    ref_spend_proxy_script_hash: expectBytes(
      fields[5],
      "ref_spend_proxy_script_hash"
    ),
    ref_spend_governor: expectBytes(fields[6], "ref_spend_governor"),
    ref_spend_admin: expectBytes(fields[7], "ref_spend_admin"),
    royalty_spend_script_hash: expectBytes(
      fields[8],
      "royalty_spend_script_hash"
    ),
    minting_start_time: Number(expectInt(fields[9], "minting_start_time")),
    payment_address: decodeAddressFromData(fields[10], isMainnet),
  };
};

const buildRefSpendSettingsV1Data = (settings: RefSpendSettingsV1): PlutusData =>
  constr(0, [bytes(settings.policy_id), bytes(settings.ref_spend_admin)]);

const decodeRefSpendSettingsV1Data = (data: PlutusData): RefSpendSettingsV1 => {
  const { fields } = expectConstr(data, "RefSpendSettingsV1", 0, 2);
  return {
    policy_id: expectBytes(fields[0], "policy_id"),
    ref_spend_admin: expectBytes(fields[1], "ref_spend_admin"),
  };
};

export {
  buildRefSpendSettingsV1Data,
  buildSettingsV1Data,
  decodeRefSpendSettingsV1Data,
  decodeSettingsV1Data,
};
