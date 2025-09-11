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
  randomizer: string
): UplcValue[] => {
  return [
    makeUplcDataValue(makeByteArrayData(hal_policy_id)),
    makeUplcDataValue(makeByteArrayData(randomizer)),
  ];
};

const makeOrdersSpendUplcProgramParameterDatum = (
  hal_policy_id: string,
  randomizer: string
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(
    makeListData([
      makeByteArrayData(hal_policy_id),
      makeByteArrayData(randomizer),
    ])
  );
};

const makeRoyaltySpendUplcProgramParameter = (
  royalty_spend_admin: string
): UplcValue[] => {
  return [makeUplcDataValue(makeByteArrayData(royalty_spend_admin))];
};

const makeRoyaltySpendUplcProgramParameterDatum = (
  royalty_spend_admin: string
): InlineTxOutputDatum => {
  return makeInlineTxOutputDatum(
    makeListData([makeByteArrayData(royalty_spend_admin)])
  );
};

export {
  makeMintingDataUplcProgramParameter,
  makeMintingDataUplcProgramParameterDatum,
  makeMintProxyUplcProgramParameter,
  makeMintProxyUplcProgramParameterDatum,
  makeOrdersSpendUplcProgramParameter,
  makeOrdersSpendUplcProgramParameterDatum,
  makeRoyaltySpendUplcProgramParameter,
  makeRoyaltySpendUplcProgramParameterDatum,
};
