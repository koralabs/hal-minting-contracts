import {
  InlineTxOutputDatum,
  makeInlineTxOutputDatum,
} from "@helios-lang/ledger";
import {
  makeByteArrayData,
  makeIntData,
  makeListData,
  makeUplcDataValue,
  UplcValue,
} from "@helios-lang/uplc";

const makeMintProxyUplcProgramParameter = (
  mint_version: bigint
): UplcValue[] => {
  return [makeUplcDataValue(makeIntData(mint_version))];
};

const makeMintProxyUplcProgramParameterDatum = (
  mint_version: bigint
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(makeListData([makeIntData(mint_version)]));
};

const makeMintV1UplcProgramParameter = (
  minting_data_script_hash: string
): UplcValue[] => {
  return [makeUplcDataValue(makeByteArrayData(minting_data_script_hash))];
};

const makeMintV1UplcProgramParameterDatum = (
  minting_data_script_hash: string
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(
    makeListData([makeByteArrayData(minting_data_script_hash)])
  );
};

const makeMintingDataUplcProgramParameter = (
  admin_verification_key_hash: string
): UplcValue[] => {
  return [makeUplcDataValue(makeByteArrayData(admin_verification_key_hash))];
};

const makeMintingDataUplcProgramParameterDatum = (
  admin_verification_key_hash: string
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(
    makeListData([makeByteArrayData(admin_verification_key_hash)])
  );
};

const makeOrdersSpendUplcProgramParameter = (
  hal_policy_id: string,
  orders_mint_policy_id: string
): UplcValue[] => {
  return [
    makeUplcDataValue(makeByteArrayData(hal_policy_id)),
    makeUplcDataValue(makeByteArrayData(orders_mint_policy_id)),
  ];
};

const makeOrdersSpendUplcProgramParameterDatum = (
  hal_policy_id: string,
  orders_mint_policy_id: string
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(
    makeListData([
      makeByteArrayData(hal_policy_id),
      makeByteArrayData(orders_mint_policy_id),
    ])
  );
};

export {
  makeMintingDataUplcProgramParameter,
  makeMintingDataUplcProgramParameterDatum,
  makeMintProxyUplcProgramParameter,
  makeMintProxyUplcProgramParameterDatum,
  makeMintV1UplcProgramParameter,
  makeMintV1UplcProgramParameterDatum,
  makeOrdersSpendUplcProgramParameter,
  makeOrdersSpendUplcProgramParameterDatum,
};
