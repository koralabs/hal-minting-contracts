use aiken/transaction/credential.{Address}
use aiken/transaction/value.{PolicyId}
use common/hashes.{ScriptHash, VerificationKeyHash}

pub type SettingsV1 {
  policy_id: PolicyId,
  // who can mint HAL NFTs
  allowed_minter: VerificationKeyHash,
  // hal nft's price
  hal_nft_price: Int,
  // address to collect HAL NFT's cost
  payment_address: Address,
  // ref_spend Spending validator address
  // ref asset is sent to this address
  ref_spend_script_address: Address,
  // user makes an order (as UTxO) to this address
  orders_spend_script_address: Address,
  // this is policy id of token
  // which proves order UTxO is valid
  orders_mint_policy_id: PolicyId,
  // minting data script is used to check
  // all minting handles logic (for both new and legacy)
  // minting_data_asset is locked inside that script
  minting_data_script_hash: ScriptHash,
  // required when mint Orders NFT
  orders_minter: VerificationKeyHash,
  // required when spending H.A.L. reference asset
  // from Ref Spend Spending validator
  ref_spend_admin: VerificationKeyHash,
  // Maximum Amount of H.A.L. NFTs that can be ordered at once
  max_order_amount: Int,
  // max min_lovelace allowed to sent with NFT
  max_min_lovelace: Int,
}
