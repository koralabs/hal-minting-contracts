import type { PlutusData } from "../../cardano/sdk.js";

interface Settings {
  // mint withdrawal validator hash
  // this is mint_proxy governor
  mint_governor: string;
  // H.A.L. NFT's version
  mint_version: bigint;
  // setting v1 data
  data: PlutusData;
}

interface RefSpendSettings {
  // ref_spend withdrawal validator hash
  // this is ref_spend_proxy governor
  ref_spend_governor: string;
  // setting v1 data
  data: PlutusData;
}

export type { RefSpendSettings, Settings };
