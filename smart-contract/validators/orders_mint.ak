use aiken/transaction.{Mint, ScriptContext}
use aiken/transaction/credential.{Address}
use validations/orders_mint/validation.{can_burn_orders, can_mint_order}

type OrderMintRedeemer {
  MintOrder(Address, Int)
  BurnOrders
}

// This is Minting Policy for Order NFTs
// Order NFTs are used to check UTxOs in Orders Spend validator
// are valid
//
// When mint Order NFT, the NFT must be sent to `orders_spend` script address
// once that UTxO with Order NFT can be spent, the NFT can be burnt any time.
//
validator {
  fn mint(redeemer: OrderMintRedeemer, ctx: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = ctx
    expect Mint(policy_id) = purpose

    when redeemer is {
      MintOrder(destination_address, amount) ->
        can_mint_order(destination_address, amount, policy_id, transaction)
      BurnOrders -> can_burn_orders(transaction, policy_id)
    }
  }
}
