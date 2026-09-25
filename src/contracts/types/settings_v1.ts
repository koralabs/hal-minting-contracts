interface SettingsV1 {
  policy_id: string;
  // who can mint HAL NFTs
  allowed_minter: string;
  // hal nft's price
  hal_nft_price: bigint;
  // minting data script is used to check
  // all minting handles logic (for both new and legacy)
  // minting_data_asset is locked inside that script
  minting_data_script_hash: string;
  // user makes an order (as UTxO) to this script
  orders_spend_script_hash: string;
  // ref_spend_proxy Spending validator hash
  // ref asset is sent to this script
  ref_spend_proxy_script_hash: string;
  // ref_spend withdrawal validator hash
  // this is ref_spend_proxy governor
  ref_spend_governor: string;
  // ref_spend_admin is used to authorize updating CIP68 Datum
  // this is referred to as `ref_spend_admin` in `ref_spend` withdrawal validator
  ref_spend_admin: string;
  // royalty spend script hash
  // Royalty NFT is sent to this script
  royalty_spend_script_hash: string;
  // when the minting (for everyone) starts
  minting_start_time: number;
  // address to collect HAL NFT's cost
  // (bech32)
  payment_address: string;
}

interface RefSpendSettingsV1 {
  policy_id: string;
  // ref_spend admin is used to authorize updating CIP68 Datum
  // this is referred to as `ref_spend_admin` in `ref_spend` withdrawal validator
  ref_spend_admin: string;
}

export type { RefSpendSettingsV1, SettingsV1 };
