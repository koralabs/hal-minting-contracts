use aiken/list
use aiken/transaction.{ScriptContext, Transaction, WithdrawFrom}
use ref_spend/settings.{RefSpendSettings, find_ref_spend_settings}
use ref_spend/settings_v1.{RefSpendSettingsV1}

// NOTE:
// This is Withdrawal validator which holds all `ref_spend` logic
// This is referred to as `ref_spend_governor` in SettingsV1 datum
//
// Checks:
// - must attach `RefSpendSettings` NFT in reference inputs.
// - must be signed by `ref_spend_admin` from `RefSpendSettingsV1`.
//
validator {
  fn withdraw(_redeemer: Data, ctx: ScriptContext) -> Bool {
    let ScriptContext(transaction, purpose) = ctx
    expect WithdrawFrom(_) = purpose

    let Transaction { reference_inputs, extra_signatories, .. } = transaction

    // must attach `RefSpendSettings` NFT in reference inputs.
    let RefSpendSettings { data: settings_data, .. } =
      find_ref_spend_settings(reference_inputs)
    expect settings_datum: RefSpendSettingsV1 = settings_data
    let RefSpendSettingsV1 { ref_spend_admin, .. } = settings_datum

    // must be signed by `ref_spend_admin` from `RefSpendSettingsV1`.
    let is_signed_by_ref_spend_admin =
      list.has(extra_signatories, ref_spend_admin)
    expect is_signed_by_ref_spend_admin

    True
  }
}
