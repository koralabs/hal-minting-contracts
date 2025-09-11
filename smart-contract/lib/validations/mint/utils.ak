use aiken/transaction.{InlineDatum, Output}
use aiken/transaction/credential
use aiken/transaction/value.{PolicyId, Value}
use common/hashes.{ScriptHash}
use common/royalty.{RoyaltyDatum, royalty_asset_full_name}

pub fn check_mint_one_royalty_asset(
  minted_value: Value,
  hal_policy_id: PolicyId,
) -> Bool {
  when minted_value |> value.flatten is {
    [(policy_id, asset_name, quantity)] -> {
      let mint_only_one_royalty_asset = and {
          policy_id == hal_policy_id,
          asset_name == royalty_asset_full_name,
          quantity == 1,
        }
      mint_only_one_royalty_asset
    }
    _ -> False
  }
}

pub fn check_royalty_output(
  royalty_output: Output,
  hal_policy_id: PolicyId,
  royalty_spend_script_hash: ScriptHash,
) -> Bool {
  let Output {
    address: royalty_output_address,
    value: royalty_output_value,
    datum: royalty_output_datum,
    reference_script: royalty_output_reference_script,
  } = royalty_output

  // check address
  let is_royalty_output_address_valid =
    royalty_output_address == credential.from_script(royalty_spend_script_hash)
  expect is_royalty_output_address_valid

  // check value
  let expected_royalty_output_value =
    value.zero() |> value.add(hal_policy_id, royalty_asset_full_name, 1)
  let has_only_royalty_asset =
    value.without_lovelace(royalty_output_value) == expected_royalty_output_value
  expect has_only_royalty_asset

  // check datum type
  expect InlineDatum(royalty_datum) = royalty_output_datum
  expect _: RoyaltyDatum = royalty_datum

  // check reference script is None
  expect royalty_output_reference_script == None

  True
}
