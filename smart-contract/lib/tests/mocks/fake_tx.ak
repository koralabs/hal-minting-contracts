use aiken/dict
use aiken/interval
use aiken/transaction.{
  Datum, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  TransactionId,
}
use aiken/transaction/credential.{Address, StakeCredential}
use aiken/transaction/value.{Value}
use common/hashes.{ScriptHash, VerificationKeyHash}
use hal_nft_mint/minting_data.{MintingData}
use hal_nft_mint/orders.{OrderDatum}
use hal_nft_mint/settings.{Settings}
use hal_nft_mint/settings_v1.{SettingsV1}
use tests/mocks/fake_constants.{
  allowed_minter, hal_nft_policy_id, hal_nft_price, max_min_lovelace,
  max_order_amount, min_order_lovelace, mint_governor, mint_version,
  minting_data_asset_name, minting_data_asset_policy_id,
  minting_data_script_hash, orders_mint_policy_id, orders_minter,
  orders_spend_script_address, payment_address, ref_spend_admin,
  ref_spend_script_address, settings_asset_name, settings_asset_policy_id,
}

pub fn make_output(address: Address, v: Value) -> Output {
  Output { address, value: v, datum: NoDatum, reference_script: None }
}

pub fn make_output_with_datum(
  address: Address,
  v: Value,
  datum: Datum,
) -> Output {
  Output { address, value: v, datum, reference_script: None }
}

pub fn make_order_input(
  owner_verification_key_hash: VerificationKeyHash,
) -> Input {
  let order: OrderDatum =
    OrderDatum {
      owner_key_hash: owner_verification_key_hash,
      price: 180_000_000,
      destination_address: credential.from_verification_key(
        owner_verification_key_hash,
      ),
      amount: 1,
    }
  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: #"aaaa" },
      output_index: 0,
    },
    output: Output {
      address: orders_spend_script_address(),
      value: value.from_lovelace(min_order_lovelace),
      datum: InlineDatum(order),
      reference_script: None,
    },
  }
}

pub fn make_test_address() -> Address {
  credential.from_verification_key(#"00")
    |> credential.with_delegation_key(#"00")
}

pub fn make_settings_reference_input() -> Input {
  let settings_v1: SettingsV1 =
    SettingsV1 {
      policy_id: hal_nft_policy_id,
      allowed_minter,
      hal_nft_price,
      payment_address: payment_address(),
      ref_spend_script_address: ref_spend_script_address(),
      orders_spend_script_address: orders_spend_script_address(),
      orders_mint_policy_id,
      minting_data_script_hash,
      orders_minter,
      ref_spend_admin,
      max_order_amount,
      max_min_lovelace,
    }
  let settings: Settings =
    Settings { mint_governor, mint_version, data: settings_v1 }

  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: #"aaaa" },
      output_index: 0,
    },
    output: Output {
      address: credential.from_verification_key(#"aaaa"),
      value: value.zero()
        |> value.add(settings_asset_policy_id, settings_asset_name, 1),
      datum: InlineDatum(settings),
      reference_script: None,
    },
  }
}

pub fn make_minting_data_output(
  mpt_root_hash: ByteArray,
  output_script_hash: ScriptHash,
) -> Output {
  let minting_data: MintingData = MintingData { mpt_root_hash }
  Output {
    address: credential.from_script(output_script_hash),
    value: value.zero()
      |> value.add(minting_data_asset_policy_id, minting_data_asset_name, 1),
    datum: InlineDatum(minting_data),
    reference_script: None,
  }
}

pub fn make_minting_data_input(
  mpt_root_hash: ByteArray,
  output_script_hash: ScriptHash,
) -> Input {
  let minting_data: MintingData = MintingData { mpt_root_hash }
  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: #"aaab" },
      output_index: 0,
    },
    output: Output {
      address: credential.from_script(output_script_hash),
      value: value.zero()
        |> value.add(minting_data_asset_policy_id, minting_data_asset_name, 1),
      datum: InlineDatum(minting_data),
      reference_script: None,
    },
  }
}

pub fn make_fee_output(fee_address: Address, fee: Int) {
  Output {
    address: fee_address,
    value: value.from_lovelace(fee),
    datum: InlineDatum(Void),
    reference_script: None,
  }
}

pub fn make_transaction(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint_value: Value,
  withdrawals: Pairs<StakeCredential, Int>,
  extra_signatories: List<VerificationKeyHash>,
) -> Transaction {
  Transaction {
    inputs,
    reference_inputs,
    outputs,
    fee: value.zero(),
    mint: mint_value |> value.to_minted_value,
    certificates: [],
    withdrawals,
    validity_range: interval.everything(),
    extra_signatories,
    redeemers: [],
    datums: dict.new(),
    id: TransactionId { hash: #"" },
  }
}
