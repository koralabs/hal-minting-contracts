use aiken/list
use aiken/transaction.{Transaction}
use aiken/transaction/credential.{Address}
use aiken/transaction/value.{PolicyId}
use hal_nft_mint/orders.{order_asset_name}
use hal_nft_mint/settings.{Settings, find_settings}
use hal_nft_mint/settings_v1.{SettingsV1}
use validations/orders_mint/utils.{is_order_output_valid}

// Validation:
// When user requests Order(s) (amount) to mint H.A.L. NFT(s)
//
// Checks:
// - must attach Setting in reference inputs
// - own minting policy id must be same as orders_mint_policy_id from Settings
// - must be signed by orders_minter
// - amount must be positive
// - amount must not exceed max_order_amount
// - must have valid Order output
//   address must be orders_spend_script_address
//   must have valid `OrderDatum` with matching destination_address and amount
//   must have only one Order NFT and enough lovelace
// - must mint only one Order NFT
//
pub fn can_mint_order(
  destination_address: Address,
  amount: Int,
  own_policy_id: PolicyId,
  transaction: Transaction,
) -> Bool {
  let Transaction { outputs, reference_inputs, extra_signatories, mint, .. } =
    transaction

  // must attach Setting in reference inputs
  let Settings { data: settings_data, .. } = find_settings(reference_inputs)
  expect settings_datum: SettingsV1 = settings_data
  let SettingsV1 {
    hal_nft_price,
    orders_spend_script_address,
    orders_mint_policy_id,
    orders_minter,
    max_order_amount,
    ..
  } = settings_datum

  // own minting policy id must be same as orders_mint_policy_id from Settings
  expect orders_mint_policy_id == own_policy_id

  // must be signed by orders_minter
  let is_orders_minter_signed = list.has(extra_signatories, orders_minter)
  expect is_orders_minter_signed

  // amount must be positive
  expect amount > 0

  // amount must not exceed max_order_amount
  expect amount <= max_order_amount

  // parse outputs
  expect [order_output, _] = outputs

  // must have valid Order output
  // address must be orders_spend_script_address
  // must have valid `OrderDatum` with matching destination_address and amount
  // must have only one Order NFT and enough lovelace
  let order_mint_value =
    is_order_output_valid(
      own_policy_id,
      hal_nft_price,
      orders_spend_script_address,
      destination_address,
      amount,
      order_output,
    )

  // must mint only one Order NFT
  expect value.from_minted_value(mint) == order_mint_value

  True
}

// Validation:
// When burn Order NFts
//
// Checks:
// - must only burn Order NFTs
//
// NOTE:
// once Order UTxO with Order NFT is spent, Order NFT can be spent any time.

pub fn can_burn_orders(
  transaction: Transaction,
  own_policy_id: PolicyId,
) -> Bool {
  let Transaction { mint, .. } = transaction

  // must only burn Order NFTs
  let minted_value = value.from_minted_value(mint)
  let only_burn_order_nfts =
    when minted_value |> value.flatten is {
      [(policy_id, asset_name, quantity)] -> {
        let is_policy_id_correct = policy_id == own_policy_id
        let is_asset_name_correct = asset_name == order_asset_name
        let must_only_burn = quantity < 0

        expect is_policy_id_correct
        expect is_asset_name_correct
        expect must_only_burn
        True
      }
      _ -> {
        trace @"must only burn Order NFTs"
        False
      }
    }

  expect only_burn_order_nfts
  True
}
