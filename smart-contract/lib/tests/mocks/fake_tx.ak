use aiken/builtin.{b_data}
use aiken/bytearray
use aiken/dict
use aiken/list
use aiken/transaction.{
  Datum, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  TransactionId, ValidityRange,
}
use aiken/transaction/credential.{
  Address, Inline, ScriptCredential, StakeCredential, VerificationKeyCredential,
}
use aiken/transaction/value.{AssetName, Value}
use common/cip68.{CIP68Datum, prefix_100, prefix_222}
use common/hashes.{ScriptHash, VerificationKeyHash}
use common/royalty.{RoyaltyDatum}
use hal_nft_mint/minting_data.{MintingData}
use hal_nft_mint/orders.{OrderDatum}
use hal_nft_mint/settings.{Settings}
use hal_nft_mint/settings_v1.{SettingsV1}
use ref_spend/settings.{RefSpendSettings} as ref_spend_settings
use ref_spend/settings_v1.{RefSpendSettingsV1} as ref_spend_settings_v1
use tests/mocks/fake_constants.{
  allowed_minter, hal_nft_price, hal_policy_id, mint_governor, mint_version,
  minting_data_asset_name, minting_data_asset_policy_id,
  minting_data_script_hash, minting_start_time, orders_spend_script_hash,
  payment_address, ref_spend_admin, ref_spend_governor,
  ref_spend_proxy_script_hash, ref_spend_settings_asset_name,
  ref_spend_settings_asset_policy_id, royalty_spend_script_hash,
  settings_asset_name, settings_asset_policy_id,
}

pub fn make_order_datum(user_address: Address, amount: Int) -> OrderDatum {
  expect Address {
    payment_credential: VerificationKeyCredential(owner_verification_key_hash),
    ..
  } = user_address

  OrderDatum {
    owner_key_hash: owner_verification_key_hash,
    destination_address: user_address,
    amount,
  }
}

pub fn make_order_input(
  user_address: Address,
  amount: Int,
  lovelace_value: Int,
  tx_hash: ByteArray,
) -> Input {
  let order_datum: OrderDatum = make_order_datum(user_address, amount)

  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: tx_hash },
      output_index: 0,
    },
    output: Output {
      address: credential.from_script(orders_spend_script_hash),
      value: value.from_lovelace(lovelace_value),
      datum: InlineDatum(order_datum),
      reference_script: None,
    },
  }
}

pub fn make_ref_spend_proxy_input(
  asset_name: AssetName,
  tx_hash: ByteArray,
) -> Input {
  let datum: Datum = make_cip68_datum(asset_name)
  let ref_asset_name = bytearray.concat(prefix_100, asset_name)

  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: tx_hash },
      output_index: 0,
    },
    output: Output {
      address: credential.from_script(ref_spend_proxy_script_hash),
      value: value.zero()
        |> value.add(hal_policy_id, ref_asset_name, 1),
      datum,
      reference_script: None,
    },
  }
}

pub fn make_ref_spend_proxy_user_input_and_output(
  user_1_address: Address,
  asset_name: AssetName,
) -> (Input, Output) {
  let user_asset_name = bytearray.concat(prefix_222, asset_name)

  (
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: #"0000" },
        output_index: 0,
      },
      output: Output {
        address: user_1_address,
        value: value.zero()
          |> value.add(hal_policy_id, user_asset_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    },
    Output {
      address: user_1_address,
      value: value.zero()
        |> value.add(hal_policy_id, user_asset_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  )
}

pub fn make_user_output(
  user_address: Address,
  asset_names: List<AssetName>,
) -> Output {
  let output_value =
    asset_names
      |> list.foldl(
          value.zero(),
          fn(asset_name, acc) -> Value {
            let user_asset_name = bytearray.concat(prefix_222, asset_name)
            acc |> value.add(hal_policy_id, user_asset_name, 1)
          },
        )

  Output {
    address: user_address,
    value: output_value,
    datum: InlineDatum(Void),
    reference_script: None,
  }
}

pub fn make_reference_outputs(asset_names: List<AssetName>) -> List<Output> {
  asset_names
    |> list.map(
        fn(asset_name) -> Output {
          let ref_asset_name = bytearray.concat(prefix_100, asset_name)
          Output {
            address: credential.from_script(ref_spend_proxy_script_hash),
            value: value.zero()
              |> value.add(hal_policy_id, ref_asset_name, 1),
            datum: make_cip68_datum(asset_name),
            reference_script: None,
          }
        },
      )
}

pub fn make_hal_minted_value(asset_names: List<AssetName>) -> Value {
  asset_names
    |> list.foldl(
        value.zero(),
        fn(asset_name, acc) -> Value {
          let ref_asset_name = bytearray.concat(prefix_100, asset_name)
          let user_asset_name = bytearray.concat(prefix_222, asset_name)
          acc
            |> value.add(hal_policy_id, ref_asset_name, 1)
            |> value.add(hal_policy_id, user_asset_name, 1)
        },
      )
}

pub fn make_settings_reference_input() -> Input {
  let settings_v1: SettingsV1 =
    SettingsV1 {
      policy_id: hal_policy_id,
      allowed_minter,
      hal_nft_price,
      minting_data_script_hash,
      orders_spend_script_hash,
      ref_spend_proxy_script_hash,
      ref_spend_governor,
      ref_spend_admin,
      royalty_spend_script_hash,
      minting_start_time,
      payment_address: payment_address(),
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

pub fn make_ref_spend_settings_reference_input() -> Input {
  let settings_v1: RefSpendSettingsV1 =
    RefSpendSettingsV1 { policy_id: hal_policy_id, ref_spend_admin }
  let settings: RefSpendSettings =
    RefSpendSettings { ref_spend_governor, data: settings_v1 }

  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: #"aaaa" },
      output_index: 0,
    },
    output: Output {
      address: credential.from_verification_key(#"aaaa"),
      value: value.zero()
        |> value.add(
            ref_spend_settings_asset_policy_id,
            ref_spend_settings_asset_name,
            1,
          ),
      datum: InlineDatum(settings),
      reference_script: None,
    },
  }
}

pub fn make_minting_data_output(
  mpt_root_hash: ByteArray,
  whitelist_mpt_root_hash: ByteArray,
  output_script_hash: ScriptHash,
) -> Output {
  let minting_data: MintingData =
    MintingData { mpt_root_hash, whitelist_mpt_root_hash }
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
  whitelist_mpt_root_hash: ByteArray,
  output_script_hash: ScriptHash,
  tx_hash: ByteArray,
) -> Input {
  let minting_data: MintingData =
    MintingData { mpt_root_hash, whitelist_mpt_root_hash }
  Input {
    output_reference: OutputReference {
      transaction_id: TransactionId { hash: tx_hash },
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

pub fn make_withdrawals(script_hash: ScriptHash) -> Pairs<StakeCredential, Int> {
  [Pair(Inline(ScriptCredential(script_hash)), 0)]
}

pub fn make_transaction(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint_value: Value,
  withdrawals: Pairs<StakeCredential, Int>,
  extra_signatories: List<VerificationKeyHash>,
  validity_range: ValidityRange,
) -> Transaction {
  Transaction {
    inputs,
    reference_inputs,
    outputs,
    fee: value.zero(),
    mint: mint_value |> value.to_minted_value,
    certificates: [],
    withdrawals,
    validity_range,
    extra_signatories,
    redeemers: [],
    datums: dict.new(),
    id: TransactionId { hash: #"" },
  }
}

pub fn make_royalty_datum() -> Datum {
  InlineDatum(RoyaltyDatum { recipients: [], version: 1, extra: Void })
}

pub fn make_cip68_datum(asset_name: AssetName) -> Datum {
  InlineDatum(
    CIP68Datum {
      metadata: [Pair(b_data("name"), b_data(asset_name))],
      version: 1,
      extra: Void,
    },
  )
}
