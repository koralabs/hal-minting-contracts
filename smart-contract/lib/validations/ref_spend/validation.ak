use aiken/list
use aiken/transaction.{InlineDatum, Output, Transaction}
use aiken/transaction/value.{AssetName}
use common/cip68.{CIP68Datum}
use ref_spend/settings.{RefSpendSettings, find_ref_spend_settings}
use ref_spend/settings_v1.{RefSpendSettingsV1}
use validations/ref_spend/utils.{
  does_spend_only_one_ref_asset, does_spend_user_asset,
}

// Validation:
// When user updates H.A.L. NFT's datum.
//
// Checks:
// - must attach `RefSpendSettings` NFT in reference inputs.
// - must be signed by `ref_spend_admin` from RefSpendSettingsV1.
// - must spend H.A.L. User Asset whose name is `asset_name` from redeemer.
// - there must be only one transaction input with H.A.L. Reference Asset.
// - the first output must be `reference_output`.
//
pub fn can_update(transaction: Transaction, asset_name: AssetName) -> Bool {
  trace @"can_update"
  let Transaction { inputs, reference_inputs, outputs, extra_signatories, .. } =
    transaction

  // must attach `RefSpendSettings` NFT in reference inputs.
  let RefSpendSettings { data: settings_data, .. } =
    find_ref_spend_settings(reference_inputs)
  expect settings_datum: RefSpendSettingsV1 = settings_data
  let RefSpendSettingsV1 { policy_id: hal_policy_id, ref_spend_admin } =
    settings_datum

  // must be signed by `ref_spend_admin` from parameter.
  expect list.has(extra_signatories, ref_spend_admin)

  // must spend H.A.L. User Asset whose name is `asset_name` from redeemer.
  let spend_user_asset =
    does_spend_user_asset(inputs, hal_policy_id, asset_name)
  expect spend_user_asset

  // there must be only one transaction input with H.A.L. Reference Asset.
  let ref_asset_utxo =
    does_spend_only_one_ref_asset(inputs, hal_policy_id, asset_name)
  let Output { address: input_address, value: input_value, .. } = ref_asset_utxo

  // the first output must be `reference_output`.
  expect [ref_asset_output, ..] = outputs
  let Output {
    address: output_address,
    value: output_value,
    datum: output_datum,
    reference_script: output_reference_script,
  } = ref_asset_output

  // address must stay same
  expect input_address == output_address

  // value must stay same
  let value_stay_same =
    value.without_lovelace(input_value) == value.without_lovelace(output_value)
  expect value_stay_same

  // datum must be CIP68Datum
  expect InlineDatum(output_datum) = output_datum
  expect _: CIP68Datum = output_datum

  // reference_script must be none
  expect output_reference_script == None

  True
}
