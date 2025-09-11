import { decodeUplcProgramV2FromCbor, UplcProgramV2 } from "@helios-lang/uplc";

import { CONTRACT_NAME } from "../constants/index.js";
import { invariant } from "../helpers/index.js";
import optimizedBlueprint from "./optimized-blueprint.js";
import unOptimizedBlueprint from "./unoptimized-blueprint.js";
import {
  makeMintingDataUplcProgramParameter,
  makeMintProxyUplcProgramParameter,
  makeOrdersSpendUplcProgramParameter,
  makeRoyaltySpendUplcProgramParameter,
} from "./utils.js";

const getMintProxyMintUplcProgram = (mint_version: bigint): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINT_PROXY_MINT
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINT_PROXY_MINT
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Mint Proxy Mint Validator not found"
  );
  return decodeUplcProgramV2FromCbor(optimizedFoundValidator.compiledCode)
    .apply(makeMintProxyUplcProgramParameter(mint_version))
    .withAlt(
      decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode).apply(
        makeMintProxyUplcProgramParameter(mint_version)
      )
    );
};

const getMintWithdrawUplcProgram = (): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINT_WITHDRAW
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINT_WITHDRAW
  );
  invariant(
    !!optimizedFoundValidator && unOptimizedFoundValidator,
    "Mint Withdrawal Validator not found"
  );
  return decodeUplcProgramV2FromCbor(
    optimizedFoundValidator.compiledCode
  ).withAlt(
    decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode)
  );
};

// this is `minting_data_script_hash`
const getMintingDataSpendUplcProgram = (
  admin_verification_key_hash: string
): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINTING_DATA_SPEND
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.MINTING_DATA_SPEND
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Minting Data Spend Validator not found"
  );
  return decodeUplcProgramV2FromCbor(optimizedFoundValidator.compiledCode)
    .apply(makeMintingDataUplcProgramParameter(admin_verification_key_hash))
    .withAlt(
      decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode).apply(
        makeMintingDataUplcProgramParameter(admin_verification_key_hash)
      )
    );
};

const getOrdersSpendUplcProgram = (
  hal_policy_id: string,
  randomizer: string
): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.ORDERS_SPEND_SPEND
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.ORDERS_SPEND_SPEND
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Orders Spend Validator not found"
  );
  return decodeUplcProgramV2FromCbor(optimizedFoundValidator.compiledCode)
    .apply(makeOrdersSpendUplcProgramParameter(hal_policy_id, randomizer))
    .withAlt(
      decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode).apply(
        makeOrdersSpendUplcProgramParameter(hal_policy_id, randomizer)
      )
    );
};

const getRefSpendProxyUplcProgram = (): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.REF_SPEND_PROXY_SPEND
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.REF_SPEND_PROXY_SPEND
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Ref Spend Proxy Validator not found"
  );
  return decodeUplcProgramV2FromCbor(
    optimizedFoundValidator.compiledCode
  ).withAlt(
    decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode)
  );
};

const getRefSpendUplcProgram = (): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.REF_SPEND_WITHDRAW
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.REF_SPEND_WITHDRAW
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Ref Spend Validator not found"
  );
  return decodeUplcProgramV2FromCbor(
    optimizedFoundValidator.compiledCode
  ).withAlt(
    decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode)
  );
};

const getRoyaltySpendUplcProgram = (
  royalty_spend_admin: string
): UplcProgramV2 => {
  const optimizedFoundValidator = optimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.ROYALTY_SPEND_SPEND
  );
  const unOptimizedFoundValidator = unOptimizedBlueprint.validators.find(
    (validator) => validator.title == CONTRACT_NAME.ROYALTY_SPEND_SPEND
  );
  invariant(
    !!optimizedFoundValidator && !!unOptimizedFoundValidator,
    "Ref Spend Validator not found"
  );
  return decodeUplcProgramV2FromCbor(optimizedFoundValidator.compiledCode)
    .apply(makeRoyaltySpendUplcProgramParameter(royalty_spend_admin))
    .withAlt(
      decodeUplcProgramV2FromCbor(unOptimizedFoundValidator.compiledCode).apply(
        makeRoyaltySpendUplcProgramParameter(royalty_spend_admin)
      )
    );
};

export {
  getMintingDataSpendUplcProgram,
  getMintProxyMintUplcProgram,
  getMintWithdrawUplcProgram,
  getOrdersSpendUplcProgram,
  getRefSpendProxyUplcProgram,
  getRefSpendUplcProgram,
  getRoyaltySpendUplcProgram,
};
