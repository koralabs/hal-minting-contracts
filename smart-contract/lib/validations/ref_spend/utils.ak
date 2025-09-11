use aiken/bytearray
use aiken/dict
use aiken/list
use aiken/transaction.{Input, Output}
use aiken/transaction/value.{AssetName, PolicyId, Value}
use common/cip68.{prefix_100, prefix_222}
use common/utils.{bytearray_starts_with}

// must spend H.A.L. User Asset whose name is `asset_name` from redeemer.
pub fn does_spend_user_asset(
  inputs: List<Input>,
  hal_policy_id: PolicyId,
  asset_name: AssetName,
) -> Bool {
  let user_asset_name = bytearray.concat(prefix_222, asset_name)
  inputs
    |> list.any(
        fn(input: Input) -> Bool {
          let Input { output: Output { value: v, .. }, .. } = input
          let has_user_asset =
            ( v |> value.quantity_of(hal_policy_id, user_asset_name) ) == 1
          has_user_asset
        },
      )
}

// there must be only one transaction input with H.A.L. Reference Asset.
// that UTxO must have only one H.A.L. Reference Asset
pub fn does_spend_only_one_ref_asset(
  inputs: List<Input>,
  hal_policy_id: PolicyId,
  asset_name: AssetName,
) -> Output {
  let ref_asset_inputs =
    list.filter(
      inputs,
      fn(input) {
        let Input { output: Output { value, .. }, .. } = input
        does_value_have_reference_assets(value, hal_policy_id)
      },
    )

  // there must be only one UTxO with H.A.L. Reference Asset
  expect [ref_asset_input] = ref_asset_inputs
  // that UTxO must have only one H.A.L. Reference Asset
  let Input { output: ref_asset_utxo, .. } = ref_asset_input
  let Output { value: input_value, .. } = ref_asset_utxo
  let ref_asset_name = bytearray.concat(prefix_100, asset_name)
  let expected_value =
    value.zero() |> value.add(hal_policy_id, ref_asset_name, 1)
  let has_only_one_ref_asset =
    value.without_lovelace(input_value) == expected_value
  expect has_only_one_ref_asset

  ref_asset_utxo
}

fn does_value_have_reference_assets(v: Value, hal_policy_id: PolicyId) -> Bool {
  v
    |> value.tokens(hal_policy_id)
    |> dict.keys
    |> list.any(fn(asset_name) { bytearray_starts_with(asset_name, prefix_100) })
}
