use aiken/bytearray
use aiken/list
use aiken/merkle_patricia_forestry as mpt
use aiken/transaction.{InlineDatum, Input, Output}
use aiken/transaction/credential.{Address}
use aiken/transaction/value.{PolicyId, Value}
use common/cip68.{prefix_100, prefix_222}
use hal_nft_mint/minting_data.{mpt_minted_value}
use hal_nft_mint/orders.{OrderDatum, order_asset_name}
use validations/minting_data/types.{Fulfilment}

// - all orders (all UTxOs in transaction inputs) are fulfilled correctly
//   must have corresponding ref_outputs (Output for each reference HAL NFT. There must be fulfilled amount of Outputs)
//   must have one user_output (Output for user HAL NFTs. All user HAL NFTs will be in same UTxO.)
//   optionally have leftover_output, where Order NFT will be sent with left over lovelace and left over amount. (amount - fulfilled amount)
pub fn are_all_orders_fulfilled(
  orders_datum_list: List<OrderDatum>,
  outputs: List<Output>,
  root: mpt.MerklePatriciaForestry,
  minting_hal_value: Value,
  policy_id: PolicyId,
  ref_spend_script_address: Address,
  fulfilments: List<Fulfilment>,
  continuation: fn(mpt.MerklePatriciaForestry, Value) -> result,
) -> result {
  when orders_datum_list is {
    [] -> continuation(root, minting_hal_value)
    [order_datum, ..rest_orders_datum_list] -> {
      // parse fulfilments
      expect [fulfilment, ..rest_fulfilments] = fulfilments

      // check if order is fulfilled
      let (rest_outputs, new_root, new_minting_hal_value) =
        is_order_fulfilled(
          order_datum,
          outputs,
          root,
          minting_hal_value,
          policy_id,
          ref_spend_script_address,
          fulfilment,
        )

      are_all_orders_fulfilled(
        rest_orders_datum_list,
        rest_outputs,
        new_root,
        new_minting_hal_value,
        policy_id,
        ref_spend_script_address,
        rest_fulfilments,
        continuation,
      )
    }
  }
}

fn is_order_fulfilled(
  order_datum: OrderDatum,
  outputs: List<Output>,
  root: mpt.MerklePatriciaForestry,
  minting_hal_value: Value,
  policy_id: PolicyId,
  ref_spend_script_address: Address,
  fulfilment: Fulfilment,
) -> (List<Output>, mpt.MerklePatriciaForestry, Value) {
  let OrderDatum { destination_address, amount: order_amount, .. } = order_datum

  // check if order amount is positive
  expect order_amount > 0

  // check if order is fulfilled
  let fulfilled = list.length(fulfilment) == order_amount
  expect fulfilled

  // check ref outputs
  let (rest_outputs, new_root, ref_hal_value, user_hal_value) =
    check_ref_outputs(
      outputs,
      root,
      policy_id,
      ref_spend_script_address,
      fulfilment,
    )

  // check user output
  expect [user_output, ..rest_outputs] = rest_outputs
  expect is_user_output_valid(user_output, destination_address, user_hal_value)

  // calculate new minting hal value
  let new_minting_hal_value =
    minting_hal_value
      |> value.merge(ref_hal_value)
      |> value.merge(user_hal_value)

  (rest_outputs, new_root, new_minting_hal_value)
}

fn check_ref_outputs(
  outputs: List<Output>,
  root: mpt.MerklePatriciaForestry,
  policy_id: PolicyId,
  ref_spend_script_address: Address,
  fulfilment: Fulfilment,
) -> (List<Output>, mpt.MerklePatriciaForestry, Value, Value) {
  let
    rest_outputs,
    new_root,
    ref_hal_value,
    user_hal_value,
  <-
    do_check_ref_outputs(
      outputs,
      root,
      value.zero(),
      value.zero(),
      policy_id,
      ref_spend_script_address,
      fulfilment,
    )

  (rest_outputs, new_root, ref_hal_value, user_hal_value)
}

fn do_check_ref_outputs(
  outputs: List<Output>,
  root: mpt.MerklePatriciaForestry,
  ref_hal_value: Value,
  user_hal_value: Value,
  policy_id: PolicyId,
  ref_spend_script_address: Address,
  fulfilment: Fulfilment,
  continuation: fn(List<Output>, mpt.MerklePatriciaForestry, Value, Value) ->
    result,
) -> result {
  when fulfilment is {
    [] -> continuation(outputs, root, ref_hal_value, user_hal_value)
    [(asset_name, mpt_proof), ..rest_fulfilment] -> {
      // update root
      let new_root = update_root(root, asset_name, mpt_proof)

      // make ref asset name and user asset name from asset_name
      let ref_asset_name = bytearray.concat(prefix_100, asset_name)
      let user_asset_name = bytearray.concat(prefix_222, asset_name)

      // parse outputs
      expect [ref_output, ..rest_outputs] = outputs

      // check ref output
      let Output {
        address: ref_output_address,
        value: ref_output_value,
        reference_script: ref_output_reference_script,
        ..
      } = ref_output
      expect ref_output_address == ref_spend_script_address
      let expected_ref_value =
        value.zero()
          |> value.add(policy_id, ref_asset_name, 1)
      let does_ref_output_have_asset =
        value.without_lovelace(ref_output_value) == expected_ref_value
      expect does_ref_output_have_asset
      expect ref_output_reference_script == None

      // make new ref_hal_value and user_hal_value
      let new_ref_hal_value =
        ref_hal_value
          |> value.add(policy_id, ref_asset_name, 1)
      let new_user_hal_value =
        user_hal_value
          |> value.add(policy_id, user_asset_name, 1)

      do_check_ref_outputs(
        rest_outputs,
        new_root,
        new_ref_hal_value,
        new_user_hal_value,
        policy_id,
        ref_spend_script_address,
        rest_fulfilment,
        continuation,
      )
    }
  }
}

fn is_user_output_valid(
  user_output: Output,
  destination_address: Address,
  user_hal_value: Value,
) -> Bool {
  let Output { address: user_output_address, value: user_output_value, .. } =
    user_output
  expect user_output_address == destination_address
  let does_user_output_value_have_assets =
    value.merge(
      value.without_lovelace(user_output_value),
      value.negate(user_hal_value),
    ) == value.zero()

  expect does_user_output_value_have_assets

  True
}

// This function updates the mpt root
// and returns new root
// update asset name (as key) value 
// to datum hash
// we assume old value is empty string
// because asset is not minted yet
//
fn update_root(
  root: mpt.MerklePatriciaForestry,
  asset_name: ByteArray,
  mpt_proof: mpt.Proof,
) -> mpt.MerklePatriciaForestry {
  root |> mpt.update(asset_name, mpt_proof, #"", mpt_minted_value)
}

pub fn resolve_orders_information(
  inputs: List<Input>,
  orders_datum_list: List<OrderDatum>,
  orders_count: Int,
  total_price: Int,
  orders_spend_script_address: Address,
  orders_mint_policy_id: PolicyId,
  continuation: fn(List<OrderDatum>, Int, Int) -> result,
) -> result {
  when inputs is {
    [] -> continuation(orders_datum_list, orders_count, total_price)
    [order_input, ..rest_inputs] -> {
      let Output { address, datum, value: order_input_value, .. } =
        order_input.output

      let is_order = address == orders_spend_script_address
      when is_order is {
        True -> {
          // parse order datum
          expect InlineDatum(datum) = datum
          expect order_datum: OrderDatum = datum

          // check order has order token
          let has_order_token =
            value.quantity_of(
              order_input_value,
              orders_mint_policy_id,
              order_asset_name,
            ) == 1
          expect has_order_token

          // calculate price
          let paid_price = order_datum.price * order_datum.amount

          resolve_orders_information(
            rest_inputs,
            [order_datum, ..orders_datum_list],
            orders_count + 1,
            total_price + paid_price,
            orders_spend_script_address,
            orders_mint_policy_id,
            continuation,
          )
        }
        False ->
          resolve_orders_information(
            rest_inputs,
            orders_datum_list,
            orders_count,
            total_price,
            orders_spend_script_address,
            orders_mint_policy_id,
            continuation,
          )
      }
    }
  }
}

// This function calculates total min lovelace from outputs
// we expect that the last output is change output to payment address
// and we don't take that into account
// We also checks each output must have less than max_min_lovelace
//
pub fn get_total_min_lovelace_and_payment_output(
  outputs: List<Output>,
  max_min_lovelace: Int,
) -> (Int, Output) {
  do_calculate_total_min_lovelace(outputs, max_min_lovelace, 0)
}

fn do_calculate_total_min_lovelace(
  outputs: List<Output>,
  max_min_lovelace: Int,
  total_min_lovelace: Int,
) -> (Int, Output) {
  when outputs is {
    [] -> fail @"must have payment output."
    [payment_output] -> (total_min_lovelace, payment_output)
    [output, ..rest_outputs] -> {
      let Output { value, .. } = output
      let lovelace = value.lovelace_of(value)

      // lovelace must be smaller than or equal to max_min_lovelace
      expect lovelace <= max_min_lovelace

      do_calculate_total_min_lovelace(
        rest_outputs,
        max_min_lovelace,
        total_min_lovelace + lovelace,
      )
    }
  }
}
