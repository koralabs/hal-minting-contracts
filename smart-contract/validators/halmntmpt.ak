use aiken/transaction.{ScriptContext, Spend}
use common/hashes.{VerificationKeyHash}
use validations/minting_data/types.{Proofs}
use validations/minting_data/validation.{can_mint, can_update_mpt}

pub type MintingDataRedeemer {
  // mint hal nfts
  Mint(List<Proofs>)
  // update MPT root has
  UpdateMPT
}

// NOTE:
// This is spending validator
// It is referred to as `minting_data_script_hash` in SettingsV1
// This validators locks `Minting Data NFT`.
// which holds the MPT root hash (of all H.A.L. NFTs name)
// and Whitelist MPT root hash (of all whitelisted users address and their whitelisted options).
// To mint H.A.L. NFTs, you must spend minting_data_asset from here
//
// This validator contains almost all logic for H.A.L. NFT minting
//
// ======= Parameters =======
// `admin_verification_key_hash`: has the authority to spend minting_data_asset
// without actually minting assets
//
// datum type is Data because when minting data asset is sent with wrong datum
// still can recover asset
//
validator(admin_verification_key_hash: VerificationKeyHash) {
  pub fn spend(
    _minting_data: Data,
    redeemer: MintingDataRedeemer,
    ctx: ScriptContext,
  ) {
    let ScriptContext(transaction, purpose) = ctx
    expect Spend(spending_output_reference) = purpose

    when redeemer is {
      Mint(proofs_list) ->
        can_mint(transaction, spending_output_reference, proofs_list)
      UpdateMPT -> can_update_mpt(transaction, admin_verification_key_hash)
    }
  }
}
