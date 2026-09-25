import { Err, Ok, Result } from "ts-res";

import {
  assetId,
  holdsAsset,
  inlineDatumOf,
  PlutusData,
  scriptRewardAccount,
  Utxo,
} from "../cardano/index.js";
import { PREFIX_100 } from "../constants/index.js";
import {
  decodeRefSpendSettingsDatum,
  decodeRefSpendSettingsV1Data,
  makeVoidData,
} from "../contracts/index.js";
import { mayFail } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";
import { HalTxPlan, referTo } from "./plan.js";

interface UpdateParams {
  isMainnet: boolean;
  assetUtf8Name: string;
  refTxInput: Utxo;
  /** The new CIP-68 reference datum. */
  newDatum: PlutusData;
  deployedScripts: DeployedScripts;
  refSpendSettingsAssetTxInput: Utxo;
}

/**
 * @description Update a reference asset's datum (ref_spend_proxy spend, authorized by the ref_spend
 * withdrawal validator and the ref_spend_admin's signature).
 */
const update = async (params: UpdateParams): Promise<Result<HalTxPlan, Error>> => {
  const { isMainnet, assetUtf8Name, refTxInput, newDatum, deployedScripts, refSpendSettingsAssetTxInput } =
    params;
  const assetHexName = Buffer.from(assetUtf8Name).toString("hex");
  const { refSpendProxyScriptTxInput, refSpendScriptDetails, refSpendScriptTxInput } = deployedScripts;

  const settingsResult = mayFail(() =>
    decodeRefSpendSettingsDatum(inlineDatumOf(refSpendSettingsAssetTxInput))
  );
  if (!settingsResult.ok) {
    return Err(new Error(`Failed to decode ref spend settings: ${settingsResult.error}`));
  }
  const settingsV1Result = mayFail(() => decodeRefSpendSettingsV1Data(settingsResult.data.data));
  if (!settingsV1Result.ok) {
    return Err(new Error(`Failed to decode ref spend settings v1: ${settingsV1Result.error}`));
  }
  const { policy_id, ref_spend_admin } = settingsV1Result.data;

  const refUnit = assetId(policy_id, `${PREFIX_100}${assetHexName}`);
  if (!holdsAsset(refTxInput, refUnit)) return Err(new Error("Reference asset not found."));

  return Ok({
    inputs: [{ utxo: refTxInput, redeemer: makeVoidData() }],
    // the reference asset back to its address with the new datum (min-UTxO topped up)
    outputs: [
      {
        address: refTxInput[1].address,
        value: { coins: BigInt(0), assets: new Map([[refUnit, BigInt(1)]]) },
        datum: newDatum.toCore(),
      },
    ],
    withdrawals: [
      {
        rewardAccount: scriptRewardAccount(refSpendScriptDetails.validatorHash, isMainnet),
        quantity: BigInt(0),
        redeemer: makeVoidData(),
      },
    ],
    requiredSigners: [ref_spend_admin],
    ...referTo([refSpendSettingsAssetTxInput, refSpendProxyScriptTxInput, refSpendScriptTxInput]),
  });
};

export type { UpdateParams };
export { update };
