use aiken/list
use aiken/transaction.{ScriptContext, Spend, Transaction}
use common/hashes.{VerificationKeyHash}

// This is Spending validator
// Where H.A.L. Royalty NFT is locked with Royalty datum
//
// You can spend from this validator by signing tx with `royalty_spend_admin`
//
validator(royalty_spend_admin: VerificationKeyHash) {
  fn spend(_datum: Data, _redeemer: Data, ctx: ScriptContext) -> Bool {
    let ScriptContext(transaction, purpose) = ctx
    expect Spend(_) = purpose

    let Transaction { extra_signatories, .. } = transaction

    let is_signed_by_royalty_spend_admin =
      list.has(extra_signatories, royalty_spend_admin)
    expect is_signed_by_royalty_spend_admin

    True
  }
}
