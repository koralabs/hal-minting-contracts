import {
  InlineTxOutputDatum,
  makeAssetClass,
  makeAssets,
  makePubKeyHash,
  makeStakingAddress,
  makeStakingValidatorHash,
  makeValue,
  TxInput,
} from "@helios-lang/ledger";
import { makeTxBuilder, TxBuilder } from "@helios-lang/tx-utils";
import { Err, Ok, Result } from "ts-res";

import { PREFIX_100 } from "../constants/index.js";
import {
  decodeRefSpendSettingsDatum,
  decodeRefSpendSettingsV1Data,
  makeVoidData,
} from "../contracts/index.js";
import { mayFail } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";

interface UpdateParams {
  isMainnet: boolean;
  assetUtf8Name: string;
  refTxInput: TxInput;
  newDatum: InlineTxOutputDatum;
  deployedScripts: DeployedScripts;
  refSpendSettingsAssetTxInput: TxInput;
}

/**
 * @description Update reference asset's datum
 * @param {UpdateParams} params
 * @returns {Promise<Result<TxBuilder,  Error>>} Transaction Result
 */
const update = async (
  params: UpdateParams
): Promise<Result<TxBuilder, Error>> => {
  const {
    isMainnet,
    assetUtf8Name,
    refTxInput,
    newDatum,
    deployedScripts,
    refSpendSettingsAssetTxInput,
  } = params;
  const assetHexName = Buffer.from(assetUtf8Name).toString("hex");

  const {
    refSpendProxyScriptTxInput,
    refSpendScriptDetails,
    refSpendScriptTxInput,
  } = deployedScripts;

  // decode settings
  const settingsResult = mayFail(() =>
    decodeRefSpendSettingsDatum(refSpendSettingsAssetTxInput.datum)
  );
  if (!settingsResult.ok) {
    return Err(
      new Error(`Failed to decode ref spend settings: ${settingsResult.error}`)
    );
  }
  const { data: settingsV1Data } = settingsResult.data;
  const settingsV1Result = mayFail(() =>
    decodeRefSpendSettingsV1Data(settingsV1Data)
  );
  if (!settingsV1Result.ok) {
    return Err(
      new Error(
        `Failed to decode ref spend settings v1: ${settingsV1Result.error}`
      )
    );
  }
  const { policy_id, ref_spend_admin } = settingsV1Result.data;

  // reference asset value
  const refAssetName = `${PREFIX_100}${assetHexName}`;
  const refAssetClass = makeAssetClass(`${policy_id}.${refAssetName}`);
  const refAsset = makeAssets([[refAssetClass, 1n]]);

  // check refTxInput has ref asset
  if (!refTxInput.value.isGreaterOrEqual(makeValue(0n, refAsset))) {
    return Err(new Error("Reference asset not found."));
  }

  // start building tx
  const txBuilder = makeTxBuilder({
    isMainnet,
  });

  // <-- attach Settings asset
  txBuilder.refer(refSpendSettingsAssetTxInput);

  // <-- attach ref_spend_proxy, ref_spend scripts
  txBuilder.refer(refSpendProxyScriptTxInput, refSpendScriptTxInput);

  // <-- withdraw from ref_spend script
  txBuilder.withdrawUnsafe(
    makeStakingAddress(
      isMainnet,
      makeStakingValidatorHash(refSpendScriptDetails.validatorHash)
    ),
    0n,
    makeVoidData()
  );

  // <-- add ref_spend_admin signer
  txBuilder.addSigners(makePubKeyHash(ref_spend_admin));

  // <-- spend refTxInput
  txBuilder.spendUnsafe(refTxInput, makeVoidData());

  // <-- pay ref asset with updated datum
  txBuilder.payUnsafe(refTxInput.address, makeValue(0n, refAsset), newDatum);

  return Ok(txBuilder);
};

export { update };
export type { UpdateParams };
