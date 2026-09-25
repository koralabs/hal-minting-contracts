// Validator parameters (in application order) and the datum that records them on the deployed
// reference-script UTxO (a list of the same values).
import { bytes, int, list, PlutusData } from "../cardano/index.js";

const makeMintProxyUplcProgramParameter = (mint_version: bigint): PlutusData[] => [
  int(mint_version),
];

const makeMintingDataUplcProgramParameter = (
  admin_verification_key_hash: string
): PlutusData[] => [bytes(admin_verification_key_hash)];

const makeOrdersSpendUplcProgramParameter = (
  hal_policy_id: string,
  randomizer: string
): PlutusData[] => [bytes(hal_policy_id), bytes(randomizer)];

const makeRoyaltySpendUplcProgramParameter = (
  royalty_spend_admin: string
): PlutusData[] => [bytes(royalty_spend_admin)];

const makeMintProxyUplcProgramParameterDatum = (mint_version: bigint): PlutusData =>
  list(makeMintProxyUplcProgramParameter(mint_version));

const makeMintingDataUplcProgramParameterDatum = (
  admin_verification_key_hash: string
): PlutusData => list(makeMintingDataUplcProgramParameter(admin_verification_key_hash));

const makeOrdersSpendUplcProgramParameterDatum = (
  hal_policy_id: string,
  randomizer: string
): PlutusData => list(makeOrdersSpendUplcProgramParameter(hal_policy_id, randomizer));

const makeRoyaltySpendUplcProgramParameterDatum = (
  royalty_spend_admin: string
): PlutusData => list(makeRoyaltySpendUplcProgramParameter(royalty_spend_admin));

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
