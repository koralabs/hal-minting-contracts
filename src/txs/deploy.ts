import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";
import { type BlockfrostTxClient, toDoubleCbor } from "@koralabs/kora-labs-common/txBuild";
import { Err, Ok, Result } from "ts-res";

import { Utxo } from "../cardano/index.js";
import { CONTRACT_NAME } from "../constants/index.js";
import {
  buildContracts,
  makeMintingDataUplcProgramParameterDatum,
  makeMintProxyUplcProgramParameterDatum,
  makeOrdersSpendUplcProgramParameterDatum,
  makeRoyaltySpendUplcProgramParameterDatum,
  PlutusV2Script,
} from "../contracts/index.js";
import { convertError, invariant } from "../helpers/index.js";
import { fetchDeployedScript } from "../utils/contract.js";

interface DeployParams {
  isMainnet: boolean;
  mintVersion: bigint;
  adminVerificationKeyHash: string;
  ordersSpendRandomizer?: string | undefined;
  royaltySpendAdmin: string;
  contractName: string;
}

interface DeployData {
  /** The applied script, double-CBOR (as v1/Helios emitted it; the ledger form is its content). */
  optimizedCbor: string;
  unOptimizedCbor?: string;
  /** The validator's parameters, recorded as the reference-script UTxO's inline datum. */
  datumCbor?: string;
  validatorHash: string;
  policyId?: string;
  scriptAddress?: string;
  scriptStakingAddress?: string;
}

const cbors = (script: PlutusV2Script) => ({
  optimizedCbor: toDoubleCbor(script.cbor),
  unOptimizedCbor: toDoubleCbor(script.unoptimizedCbor),
});

/**
 * @description Deploy data of one of the HAL contracts
 */
const deploy = async (params: DeployParams): Promise<DeployData> => {
  const {
    isMainnet,
    mintVersion,
    adminVerificationKeyHash,
    ordersSpendRandomizer = "",
    royaltySpendAdmin,
    contractName,
  } = params;

  const {
    halPolicyHash,
    mintProxy,
    mint,
    mintingData,
    ordersSpend,
    refSpendProxy,
    refSpend,
    royaltySpend,
  } = buildContracts({
    isMainnet,
    mint_version: mintVersion,
    admin_verification_key_hash: adminVerificationKeyHash,
    orders_spend_randomizer: ordersSpendRandomizer,
    royalty_spend_admin: royaltySpendAdmin,
  });

  switch (contractName) {
    case CONTRACT_NAME.MINT_PROXY_MINT:
      return {
        ...cbors(mintProxy.mintProxyMintScript),
        datumCbor: makeMintProxyUplcProgramParameterDatum(mintVersion).toCbor(),
        validatorHash: mintProxy.mintProxyPolicyHash,
        policyId: mintProxy.mintProxyPolicyHash,
      };
    case CONTRACT_NAME.MINT_WITHDRAW:
      return {
        ...cbors(mint.mintWithdrawScript),
        validatorHash: mint.mintValidatorHash,
        scriptStakingAddress: mint.mintStakingAddress,
      };
    case CONTRACT_NAME.MINTING_DATA_SPEND:
      return {
        ...cbors(mintingData.mintingDataSpendScript),
        datumCbor: makeMintingDataUplcProgramParameterDatum(adminVerificationKeyHash).toCbor(),
        validatorHash: mintingData.mintingDataValidatorHash,
        scriptAddress: mintingData.mintingDataValidatorAddress,
      };
    case CONTRACT_NAME.ORDERS_SPEND_SPEND:
      return {
        ...cbors(ordersSpend.ordersSpendScript),
        datumCbor: makeOrdersSpendUplcProgramParameterDatum(
          halPolicyHash,
          ordersSpendRandomizer
        ).toCbor(),
        validatorHash: ordersSpend.ordersSpendValidatorHash,
        scriptAddress: ordersSpend.ordersSpendValidatorAddress,
      };
    case CONTRACT_NAME.REF_SPEND_PROXY_SPEND:
      return {
        ...cbors(refSpendProxy.refSpendProxyScript),
        validatorHash: refSpendProxy.refSpendProxyValidatorHash,
        scriptAddress: refSpendProxy.refSpendProxyValidatorAddress,
      };
    case CONTRACT_NAME.REF_SPEND_WITHDRAW:
      return {
        ...cbors(refSpend.refSpendScript),
        validatorHash: refSpend.refSpendValidatorHash,
        scriptStakingAddress: refSpend.refSpendStakingAddress,
      };
    case CONTRACT_NAME.ROYALTY_SPEND_SPEND:
      return {
        ...cbors(royaltySpend.royaltySpendScript),
        datumCbor: makeRoyaltySpendUplcProgramParameterDatum(royaltySpendAdmin).toCbor(),
        validatorHash: royaltySpend.royaltySpendValidatorHash,
        scriptAddress: royaltySpend.royaltySpendValidatorAddress,
      };
    default:
      throw new Error(`Contract name must be one of ${Object.values(CONTRACT_NAME).join(", ")}`);
  }
};

interface DeployedScripts {
  mintProxyScriptDetails: ScriptDetails;
  mintProxyScriptTxInput: Utxo;
  mintingDataScriptDetails: ScriptDetails;
  mintingDataScriptTxInput: Utxo;
  mintScriptDetails: ScriptDetails;
  mintScriptTxInput: Utxo;
  ordersSpendScriptDetails: ScriptDetails;
  ordersSpendScriptTxInput: Utxo;
  refSpendProxyScriptDetails: ScriptDetails;
  refSpendProxyScriptTxInput: Utxo;
  refSpendScriptDetails: ScriptDetails;
  refSpendScriptTxInput: Utxo;
  royaltySpendScriptDetails: ScriptDetails;
  royaltySpendScriptTxInput: Utxo;
}

/** The deployed script (per the Handle API) and its reference-script UTxO (per Blockfrost). */
const fetchDeployed = async (
  blockfrost: Pick<BlockfrostTxClient, "getUtxo">,
  type: ScriptType,
  label: string
): Promise<[ScriptDetails, Utxo]> => {
  const details = await fetchDeployedScript(type);
  invariant(details.refScriptUtxo, `${label} has no Ref script UTxO`);
  const utxo = await blockfrost.getUtxo(details.refScriptUtxo);
  invariant(utxo[1].scriptReference, `${label} Ref script UTxO carries no script`);
  return [details, utxo];
};

const fetchAllDeployedScripts = async (
  blockfrost: Pick<BlockfrostTxClient, "getUtxo">
): Promise<Result<DeployedScripts, string>> => {
  try {
    const [mintProxyScriptDetails, mintProxyScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_MINT_PROXY, "Mint Proxy");
    const [mintScriptDetails, mintScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_MINT, "Mint");
    const [mintingDataScriptDetails, mintingDataScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_MINTING_DATA, "Minting Data");
    const [ordersSpendScriptDetails, ordersSpendScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_ORDERS_SPEND, "Orders Spend");
    const [refSpendProxyScriptDetails, refSpendProxyScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_REF_SPEND_PROXY, "Ref Spend Proxy");
    const [refSpendScriptDetails, refSpendScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_REF_SPEND, "Ref Spend");
    const [royaltySpendScriptDetails, royaltySpendScriptTxInput] = await fetchDeployed(blockfrost, ScriptType.HAL_ROYALTY_SPEND, "Royalty Spend");
    return Ok({
      mintProxyScriptDetails,
      mintProxyScriptTxInput,
      mintingDataScriptDetails,
      mintingDataScriptTxInput,
      mintScriptDetails,
      mintScriptTxInput,
      ordersSpendScriptDetails,
      ordersSpendScriptTxInput,
      refSpendProxyScriptDetails,
      refSpendProxyScriptTxInput,
      refSpendScriptDetails,
      refSpendScriptTxInput,
      royaltySpendScriptDetails,
      royaltySpendScriptTxInput,
    });
  } catch (err) {
    return Err(convertError(err));
  }
};

export type { DeployData, DeployedScripts, DeployParams };
export { deploy, fetchAllDeployedScripts };
