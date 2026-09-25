// The HAL validators from the Aiken blueprint, with their parameters applied (scalus).
import { applyParamsToScript, plutusScriptHash } from "@koralabs/kora-labs-common/txBuild";

import { Cardano, PlutusData } from "../cardano/index.js";
import { CONTRACT_NAME } from "../constants/index.js";
import optimizedBlueprint from "./optimized-blueprint.js";
import unOptimizedBlueprint from "./unoptimized-blueprint.js";
import {
  makeMintingDataUplcProgramParameter,
  makeMintProxyUplcProgramParameter,
  makeOrdersSpendUplcProgramParameter,
  makeRoyaltySpendUplcProgramParameter,
} from "./utils.js";

/** A parameter-applied Plutus V2 script. */
interface PlutusV2Script {
  /** Single-CBOR (a CBOR byte string of the flat program), as a reference script / blueprint holds it. */
  cbor: string;
  /** The same program built from the unoptimized (traced) blueprint — for debugging only. */
  unoptimizedCbor: string;
  hash: string;
}

const compiledCode = (
  blueprint: { validators: { title: string; compiledCode: string }[] },
  title: CONTRACT_NAME
): string => {
  const validator = blueprint.validators.find((v) => v.title == title);
  if (!validator) throw new Error(`Validator ${title} not found in blueprint`);
  return validator.compiledCode;
};

const buildScript = (title: CONTRACT_NAME, params: PlutusData[]): PlutusV2Script => {
  const cbor = params.length
    ? applyParamsToScript(compiledCode(optimizedBlueprint, title), params)
    : compiledCode(optimizedBlueprint, title);
  const unoptimized = compiledCode(unOptimizedBlueprint, title);
  return {
    cbor,
    unoptimizedCbor: params.length ? applyParamsToScript(unoptimized, params) : unoptimized,
    hash: plutusScriptHash(cbor, Cardano.PlutusLanguageVersion.V2),
  };
};

const getMintProxyMintScript = (mint_version: bigint) =>
  buildScript(CONTRACT_NAME.MINT_PROXY_MINT, makeMintProxyUplcProgramParameter(mint_version));

const getMintWithdrawScript = () => buildScript(CONTRACT_NAME.MINT_WITHDRAW, []);

// this is `minting_data_script_hash`
const getMintingDataSpendScript = (admin_verification_key_hash: string) =>
  buildScript(
    CONTRACT_NAME.MINTING_DATA_SPEND,
    makeMintingDataUplcProgramParameter(admin_verification_key_hash)
  );

const getOrdersSpendScript = (hal_policy_id: string, randomizer: string) =>
  buildScript(
    CONTRACT_NAME.ORDERS_SPEND_SPEND,
    makeOrdersSpendUplcProgramParameter(hal_policy_id, randomizer)
  );

const getRefSpendProxyScript = () => buildScript(CONTRACT_NAME.REF_SPEND_PROXY_SPEND, []);

const getRefSpendScript = () => buildScript(CONTRACT_NAME.REF_SPEND_WITHDRAW, []);

const getRoyaltySpendScript = (royalty_spend_admin: string) =>
  buildScript(
    CONTRACT_NAME.ROYALTY_SPEND_SPEND,
    makeRoyaltySpendUplcProgramParameter(royalty_spend_admin)
  );

export type { PlutusV2Script };
export {
  getMintingDataSpendScript,
  getMintProxyMintScript,
  getMintWithdrawScript,
  getOrdersSpendScript,
  getRefSpendProxyScript,
  getRefSpendScript,
  getRoyaltySpendScript,
};
