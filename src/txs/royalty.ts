import { Err, Ok, Result } from "ts-res";

import {
  assetId,
  Cardano,
  holdsAsset,
  inlineDatumOf,
  scriptAddress,
  scriptRewardAccount,
  Utxo,
} from "../cardano/index.js";
import { ROYALTY_ASSET_FULL_NAME } from "../constants/index.js";
import {
  buildMintMintRoyaltyNFTRedeemer,
  buildRoyaltyDatumData,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  makeVoidData,
  RoyaltyDatum,
  SettingsV1,
} from "../contracts/index.js";
import { mayFail } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";
import { HalTxPlan, referTo } from "./plan.js";

const settingsV1Of = (settingsAssetTxInput: Utxo, isMainnet: boolean): Result<SettingsV1, Error> => {
  const settingsResult = mayFail(() => decodeSettingsDatum(inlineDatumOf(settingsAssetTxInput)));
  if (!settingsResult.ok) return Err(new Error(`Failed to decode settings: ${settingsResult.error}`));
  const settingsV1Result = mayFail(() => decodeSettingsV1Data(settingsResult.data.data, isMainnet));
  if (!settingsV1Result.ok)
    return Err(new Error(`Failed to decode settings v1: ${settingsV1Result.error}`));
  return Ok(settingsV1Result.data);
};

const royaltyOutput = (policyId: string, royaltySpendScriptHash: string, isMainnet: boolean, datum: RoyaltyDatum): Cardano.TxOut => ({
  address: scriptAddress(royaltySpendScriptHash, isMainnet) as Cardano.PaymentAddress,
  value: { coins: BigInt(0), assets: new Map([[assetId(policyId, ROYALTY_ASSET_FULL_NAME), BigInt(1)]]) },
  datum: buildRoyaltyDatumData(datum).toCore(),
});

interface MintRoyaltyParams {
  isMainnet: boolean;
  royaltyDatum: RoyaltyDatum;
  deployedScripts: DeployedScripts;
  settingsAssetTxInput: Utxo;
}

/**
 * @description Mint the CIP-102 Royalty token (mint withdrawal `MintRoyaltyNFT`, allowed minter
 * signs) to the royalty_spend validator.
 */
const mintRoyalty = async (params: MintRoyaltyParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, royaltyDatum, deployedScripts, settingsAssetTxInput } = params;
  const { mintProxyScriptTxInput, mintScriptDetails, mintScriptTxInput } = deployedScripts;

  const settingsV1 = settingsV1Of(settingsAssetTxInput, isMainnet);
  if (!settingsV1.ok) return settingsV1;
  const { policy_id, allowed_minter, royalty_spend_script_hash } = settingsV1.data;

  return Ok({
    inputs: [],
    outputs: [royaltyOutput(policy_id, royalty_spend_script_hash, isMainnet, royaltyDatum)],
    mint: [
      {
        policyId: policy_id,
        assets: new Map([[ROYALTY_ASSET_FULL_NAME, BigInt(1)]]),
        redeemer: makeVoidData(),
      },
    ],
    withdrawals: [
      {
        rewardAccount: scriptRewardAccount(mintScriptDetails.validatorHash, isMainnet),
        quantity: BigInt(0),
        redeemer: buildMintMintRoyaltyNFTRedeemer(),
      },
    ],
    requiredSigners: [allowed_minter],
    ...referTo([settingsAssetTxInput, mintProxyScriptTxInput, mintScriptTxInput]),
  });
};

interface UpdateRoyaltyParams {
  isMainnet: boolean;
  royaltyTxInput: Utxo;
  newRoyaltyDatum: RoyaltyDatum;
  deployedScripts: DeployedScripts;
  settingsAssetTxInput: Utxo;
  royaltySpendAdmin: string;
}

/**
 * @description Update the Royalty token's datum (royalty_spend `Update`, royalty admin signs)
 */
const updateRoyalty = async (params: UpdateRoyaltyParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, royaltyTxInput, newRoyaltyDatum, deployedScripts, settingsAssetTxInput, royaltySpendAdmin } =
    params;
  const { royaltySpendScriptTxInput } = deployedScripts;

  const settingsV1 = settingsV1Of(settingsAssetTxInput, isMainnet);
  if (!settingsV1.ok) return settingsV1;
  const { policy_id, royalty_spend_script_hash } = settingsV1.data;

  if (!holdsAsset(royaltyTxInput, assetId(policy_id, ROYALTY_ASSET_FULL_NAME))) {
    return Err(new Error("Royalty Token not found in RoyaltyTxInput"));
  }

  return Ok({
    inputs: [{ utxo: royaltyTxInput, redeemer: makeVoidData() }],
    outputs: [royaltyOutput(policy_id, royalty_spend_script_hash, isMainnet, newRoyaltyDatum)],
    requiredSigners: [royaltySpendAdmin],
    ...referTo([settingsAssetTxInput, royaltySpendScriptTxInput]),
  });
};

export type { MintRoyaltyParams, UpdateRoyaltyParams };
export { mintRoyalty, updateRoyalty };
