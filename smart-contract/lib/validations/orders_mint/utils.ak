use aiken/transaction.{InlineDatum, Output}
use aiken/transaction/credential.{Address}
use aiken/transaction/value.{PolicyId, Value}
use hal_nft_mint/orders.{OrderDatum, order_asset_name}

pub fn is_order_output_valid(
  own_policy_id: PolicyId,
  hal_nft_price: Int,
  orders_spend_script_address: Address,
  destination_address: Address,
  amount: Int,
  order_output: Output,
) -> Value {
  let Output {
    address: output_address,
    datum: output_datum,
    value: output_value,
    reference_script: output_reference_script,
  } = order_output

  // output address must be order spend script address
  expect output_address == orders_spend_script_address

  // check output datum is order datum
  // and asset name and price and destination address and amount
  // are correctly set
  expect InlineDatum(output_datum) = output_datum
  expect order_datum: OrderDatum = output_datum
  let OrderDatum {
    price,
    destination_address: order_destination_address,
    amount: order_amount,
    ..
  } = order_datum
  expect price == hal_nft_price
  expect order_destination_address == destination_address
  expect order_amount == amount

  // order mint value
  let order_mint_value =
    value.zero() |> value.add(own_policy_id, order_asset_name, 1)

  // check output value
  // has order token and correct amount of lovelace (hal_nft_price)
  let has_order_token = value.without_lovelace(output_value) == order_mint_value
  let has_enough_lovelace =
    value.lovelace_of(output_value) >= hal_nft_price * amount
  expect has_order_token && has_enough_lovelace

  // check output reference script is none
  expect output_reference_script == None

  order_mint_value
}
