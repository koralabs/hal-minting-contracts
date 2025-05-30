use aiken/list
use aiken/merkle_patricia_forestry as mpt
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use aiken/transaction/value
use common/hashes.{VerificationKeyHash}
use hal_nft_mint/minting_data.{MintingData, resolve_minting_data}
use hal_nft_mint/orders.{order_asset_name}
use hal_nft_mint/settings.{Settings, find_settings}
use hal_nft_mint/settings_v1.{SettingsV1}
use validations/minting_data/types.{Proof}
use validations/minting_data/utils.{
  all_orders_are_satisfied, calculate_total_min_lovelace,
  filter_order_inputs_to_order_datum_list,
}

// enough to pay transaction fee
// and cover collateral
// and make change UTxO
const max_change_lovelace: Int = 5_000_000

// Validation:
// All H.A.L. Minting logic is here
//
// Checks
// - must attach Setting in reference inputs
// - signed by allowed_minter
// - all orders are satisfied correctly
//   and minted values are sent to correct addresses
//   and order NFTs are burnt correctly
//   with proofs from redeemer (NOTE: must be in same order as orders UTxOs)
// - first output must be minting_data output with updated root hash
//   with same value as spending UTxO
// - second output must be payment output with total H.A.L. NFTs price
//   subtracted by total min lovelace and transaction fee
// - must mint only H.A.L. NFTs
// - must burn Order NFTs (total hal nft count)
//
pub fn can_mint(
  transaction: Transaction,
  spending_output_reference: OutputReference,
  proofs: List<Proof>,
) -> Bool {
  trace @"can_mint"
  let Transaction {
    inputs,
    reference_inputs,
    outputs,
    extra_signatories,
    mint,
    ..
  } = transaction

  // must attach Setting in reference inputs
  let Settings { data: settings_data, .. } = find_settings(reference_inputs)
  expect settings_datum: SettingsV1 = settings_data
  let SettingsV1 {
    policy_id,
    allowed_minter,
    payment_address,
    ref_spend_script_address,
    orders_spend_script_address,
    orders_mint_policy_id,
    ..
  } = settings_datum

  // signed by allowed_minter
  expect list.has(extra_signatories, allowed_minter)

  // find minting data input which is own input
  expect Some(spending_input) = find_input(inputs, spending_output_reference)
  let Input { output: minting_data_input, .. } = spending_input
  let MintingData { mpt_root_hash } = resolve_minting_data(minting_data_input)

  // parse outputs
  expect [minting_data_output, payment_output, ..rest_outputs] = outputs

  // total hal nft count
  let total_hal_nft_count = list.length(proofs)

  // build merkle patricia trie from old root hash
  let root = mpt.from_root(mpt_root_hash)

  // filter order inputs to order datum list
  let order_datum_list <-
    filter_order_inputs_to_order_datum_list(
      inputs,
      orders_spend_script_address,
      orders_mint_policy_id,
      [],
    )

  // all orders are satisfied correctly
  // and minted values are sent to correct addresses
  // and order NFTs are burnt correctly
  // with proofs from redeemer
  let
    new_root,
    expected_hal_value,
    total_price,
  <-
    all_orders_are_satisfied(
      order_datum_list,
      rest_outputs,
      policy_id,
      ref_spend_script_address,
      proofs,
      root,
      value.zero(),
      0,
    )

  // calculate total min lovelace
  let total_min_lovelace = calculate_total_min_lovelace(rest_outputs)

  // calculate new root and expected mint value
  let new_mpt_root_hash = new_root |> mpt.root

  // first output must be minting_data output with updated root hash
  // with same value as spending UTxO
  expect minting_data_output.address == minting_data_input.address
  expect
    value.without_lovelace(minting_data_output.value) == value.without_lovelace(
      minting_data_input.value,
    )
  expect
    minting_data_output.datum == InlineDatum(
      MintingData { mpt_root_hash: new_mpt_root_hash },
    )
  expect minting_data_output.reference_script == None

  // second output must be payment output with total H.A.L. NFTs price
  // subtract total min lovelace and max change lovelace from total price
  let Output {
    address: payment_output_address,
    value: payment_output_value,
    ..
  } = payment_output
  expect payment_output_address == payment_address
  let expected_payment = total_price - total_min_lovelace - max_change_lovelace
  expect expected_payment > 0
  let payment_correctly_paid =
    value.lovelace_of(payment_output_value) >= expected_payment
  expect payment_correctly_paid

  // must mint only H.A.L. NFTs and burn Order NFTs
  let minted_value = value.from_minted_value(mint)
  let hal_nfts_minted_correctly =
    value.tokens(minted_value, policy_id) == value.tokens(
      expected_hal_value,
      policy_id,
    )
  expect hal_nfts_minted_correctly

  // must burn Order NFTs
  let order_nfts_burnt_correctly =
    value.quantity_of(minted_value, orders_mint_policy_id, order_asset_name) == -total_hal_nft_count
  expect order_nfts_burnt_correctly

  True
}

// Validation:
// When admin tries to update MPT root hash
//
// Checks:
// - must not mint anything
// - must be signed by admin
//
pub fn can_update_mpt(
  transaction: Transaction,
  admin_verification_key_hash: VerificationKeyHash,
) -> Bool {
  let Transaction { extra_signatories, mint, .. } = transaction

  // must not mint anything
  expect value.from_minted_value(mint) == value.zero()

  // must be signed by admin
  expect list.has(extra_signatories, admin_verification_key_hash)

  True
}
