use aiken/transaction.{ScriptContext, WithdrawFrom}
use validations/mint/validation.{can_mint_nfts, can_mint_royalty_nft}

type MintRedeemer {
  MintNFTs
  BurnNFTs
  MintRoyaltyNFT
}

// NOTE:
// This is withdrawal validator which holds all minting logic
// This is referred to as `mint_governor` in Settings datum
//
validator {
  fn withdraw(redeemer: MintRedeemer, ctx: ScriptContext) -> Bool {
    let ScriptContext { purpose, transaction } = ctx
    expect WithdrawFrom(_) = purpose

    when redeemer is {
      MintNFTs -> can_mint_nfts(transaction)
      BurnNFTs -> {
        trace @"Burn is disabled now"
        False
      }
      MintRoyaltyNFT -> can_mint_royalty_nft(transaction)
    }
  }
}
