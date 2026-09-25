// The H.A.L. mint transaction: MPT proofs, the new minting data, reference/user outputs, redeemers
// and script inputs. The same construction the HAL minting engine runs on chain.
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { AssetNameLabel } from "@koralabs/kora-labs-common";
import { Err, Ok, Result } from "ts-res";

import {
  assetId,
  Cardano,
  inlineDatumOf,
  PlutusData,
  scriptAddress,
  scriptRewardAccount,
  Utxo,
} from "../cardano/index.js";
import { MPT_MINTED_VALUE } from "../constants/index.js";
import {
  AssetNameProof,
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintMintNFTsRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  decodeMintingDataDatum,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  decodeWhitelistedValueFromCBOR,
  makeVoidData,
  makeWhitelistedValueData,
  parseMPTProofJSON,
  Proofs,
  WhitelistedValue,
  WhitelistProof,
} from "../contracts/index.js";
import { convertError } from "../helpers/index.js";
import { DeployedScripts } from "./deploy.js";
import { HalTxPlan, referTo } from "./plan.js";
import { AggregatedOrder, HalAssetInfo, HalUserOutputData } from "./types.js";
import { getWhitelistedKey, updateWhitelistedValue } from "./whitelist.js";

const EMPTY_ROOT = Buffer.alloc(32).toString("hex");
const rootOf = (trie: Trie) => (trie.hash?.toString("hex") ?? EMPTY_ROOT).toLowerCase();

/** The validator walks orders in destination-address (whitelist key) order. */
const sortOrdersForMint = (orders: AggregatedOrder[]): AggregatedOrder[] =>
  [...orders].sort((a, b) =>
    getWhitelistedKey(a.destinationAddress)
      .toString("hex")
      .localeCompare(getWhitelistedKey(b.destinationAddress).toString("hex"))
  );

interface PrepareMintParams {
  isMainnet: boolean;
  aggregatedOrders: AggregatedOrder[];
  assetsInfo: HalAssetInfo[];
  db: Trie;
  whitelistDB: Trie;
  deployedScripts: DeployedScripts;
  settingsAssetTxInput: Utxo;
  mintingDataAssetTxInput: Utxo;
  /** The tx's validity start (POSIX ms): whitelist time gaps are measured from it. */
  mintingTime: number;
}

interface PreparedMint {
  /**
   * The whole HAL mint: outputs are the minting data (index 0 — the next mint chains from it), the
   * user outputs, then the reference outputs. Callers adding tokens may rebuild `outputs` from the
   * parts below, keeping the minting data first. Complete it with `changeAddress` = the settings'
   * payment_address: the orders' payment reaches it as change, which the validators require.
   */
  plan: HalTxPlan;
  db: Trie;
  whitelistDB: Trie;
  mintingDataOutput: Cardano.TxOut;
  userOutputsData: HalUserOutputData[];
  referenceOutputs: Cardano.TxOut[];
  updatedWhitelistedValues: Array<{ destinationAddress: string; whitelistedValue: WhitelistedValue }>;
}

const userAssetValue = (policyId: string, hexNames: string[]): Cardano.Value => ({
  coins: BigInt(1),
  assets: new Map(
    hexNames.map((hex) => [assetId(policyId, `${AssetNameLabel.LBL_222}${hex}`), BigInt(1)])
  ),
});

/**
 * @description Prepare the mint transaction.
 * ## Before calling:
 * - Validate and aggregate order UTxOs with `prepareOrders`.
 * ## NOTE:
 * - `assetsInfo` must hold exactly one H.A.L. per ordered unit.
 * - Mutates `db` / `whitelistDB` to the post-mint state (roll back with `rollBackOrdersFromTries`).
 */
const prepareMintTransaction = async (
  params: PrepareMintParams
): Promise<Result<PreparedMint, Error>> => {
  try {
    return Ok(await prepareMint(params));
  } catch (error) {
    return Err(new Error(convertError(error)));
  }
};

const prepareMint = async ({
  isMainnet,
  aggregatedOrders,
  assetsInfo: assetsInfoParam,
  db,
  whitelistDB,
  deployedScripts,
  settingsAssetTxInput,
  mintingDataAssetTxInput,
  mintingTime,
}: PrepareMintParams): Promise<PreparedMint> => {
  const orders = sortOrdersForMint(aggregatedOrders);
  const assetsInfo = [...assetsInfoParam];

  const settingsV1 = decodeSettingsV1Data(
    decodeSettingsDatum(inlineDatumOf(settingsAssetTxInput)).data,
    isMainnet
  );
  const mintingData = decodeMintingDataDatum(inlineDatumOf(mintingDataAssetTxInput));
  if (mintingData.mpt_root_hash.toLowerCase() !== rootOf(db))
    throw new Error("ERROR: Local DB and On Chain Root Hash mismatch");
  if (mintingData.whitelist_mpt_root_hash.toLowerCase() !== rootOf(whitelistDB))
    throw new Error("ERROR: Local Whitelist DB and On Chain Whitelist Root Hash mismatch");

  const { policy_id, allowed_minter, ref_spend_proxy_script_hash, minting_start_time } = settingsV1;
  const refSpendProxyAddress = scriptAddress(ref_spend_proxy_script_hash, isMainnet) as Cardano.PaymentAddress;
  const transactionTimeGap = minting_start_time - mintingTime;

  const proofsList: Proofs[] = [];
  const userOutputsData: HalUserOutputData[] = [];
  const referenceOutputs: Cardano.TxOut[] = [];
  const halAssets = new Map<string, bigint>();
  const updatedWhitelistedValues: PreparedMint["updatedWhitelistedValues"] = [];

  for (const { destinationAddress, amount, needWhitelistProof } of orders) {
    const assetNameProofs: AssetNameProof[] = [];
    const assetUtf8Names: string[] = [];
    const hexNames: string[] = [];

    for (let i = 0; i < amount; i++) {
      const assetInfo = assetsInfo.shift();
      if (!assetInfo) throw new Error("Assets Info doesn't match with Orders' amount");
      const { assetUtf8Name, assetDatum } = assetInfo;
      const hex = Buffer.from(assetUtf8Name, "utf8").toString("hex");
      if (typeof (await db.get(assetUtf8Name)) === "undefined")
        throw new Error(`Asset name is not pre-defined: ${assetUtf8Name}`);
      const proof = await db.prove(assetUtf8Name);
      await db.delete(assetUtf8Name);
      await db.insert(assetUtf8Name, MPT_MINTED_VALUE);
      assetNameProofs.push([hex, parseMPTProofJSON(proof.toJSON())]);
      assetUtf8Names.push(assetUtf8Name);
      hexNames.push(hex);

      const refUnit = `${AssetNameLabel.LBL_100}${hex}`;
      referenceOutputs.push({
        address: refSpendProxyAddress,
        value: { coins: BigInt(1), assets: new Map([[assetId(policy_id, refUnit), BigInt(1)]]) },
        datum: assetDatum.toCore(),
      });
      halAssets.set(refUnit, BigInt(1));
      halAssets.set(`${AssetNameLabel.LBL_222}${hex}`, BigInt(1));
    }

    let whitelistProof: WhitelistProof | undefined;
    if (needWhitelistProof) {
      const key = getWhitelistedKey(destinationAddress);
      const current = await whitelistDB.get(key);
      if (!current) {
        throw new Error(
          `Address ${destinationAddress} is not whitelisted. Wait until ${new Date(minting_start_time).toLocaleString()}`
        );
      }
      const decoded = decodeWhitelistedValueFromCBOR(current);
      if (!decoded.ok) throw decoded.error;
      const { newWhitelistedValue } = updateWhitelistedValue(decoded.data, amount, transactionTimeGap);
      const proof = await whitelistDB.prove(key);
      whitelistProof = [decoded.data, parseMPTProofJSON(proof.toJSON())];
      await whitelistDB.delete(key);
      await whitelistDB.insert(key, Buffer.from(makeWhitelistedValueData(newWhitelistedValue).toCbor(), "hex"));
      updatedWhitelistedValues.push({ destinationAddress, whitelistedValue: newWhitelistedValue });
    }

    proofsList.push([assetNameProofs, whitelistProof]);
    userOutputsData.push({
      assetUtf8Names,
      destinationAddress,
      userOutput: {
        address: destinationAddress as Cardano.PaymentAddress,
        value: userAssetValue(policy_id, hexNames),
      },
    });
  }

  const [, mintingDataOut] = mintingDataAssetTxInput;
  const mintingDataOutput: Cardano.TxOut = {
    address: mintingDataOut.address,
    value: mintingDataOut.value,
    datum: buildMintingData({
      ...mintingData,
      mpt_root_hash: rootOf(db),
      whitelist_mpt_root_hash: rootOf(whitelistDB),
    }).toCore(),
  };

  const {
    mintProxyScriptTxInput,
    mintScriptTxInput,
    mintScriptDetails,
    mintingDataScriptTxInput,
    ordersSpendScriptTxInput,
  } = deployedScripts;
  const executeOrders: PlutusData = buildOrdersSpendExecuteOrdersRedeemer();
  const plan: HalTxPlan = {
    inputs: [
      { utxo: mintingDataAssetTxInput, redeemer: buildMintingDataMintRedeemer(proofsList) },
      ...orders.flatMap(({ orderTxInputs }) => orderTxInputs.map((utxo) => ({ utxo, redeemer: executeOrders }))),
    ],
    outputs: [mintingDataOutput, ...userOutputsData.map((u) => u.userOutput), ...referenceOutputs],
    mint: [{ policyId: policy_id, assets: halAssets, redeemer: makeVoidData() }],
    withdrawals: [
      {
        rewardAccount: scriptRewardAccount(mintScriptDetails.validatorHash, isMainnet),
        quantity: BigInt(0),
        redeemer: buildMintMintNFTsRedeemer(),
      },
    ],
    requiredSigners: [allowed_minter],
    validFromTime: mintingTime,
    ...referTo([
      settingsAssetTxInput,
      mintProxyScriptTxInput,
      mintScriptTxInput,
      mintingDataScriptTxInput,
      ordersSpendScriptTxInput,
    ]),
  };

  return {
    plan,
    db,
    whitelistDB,
    mintingDataOutput,
    userOutputsData,
    referenceOutputs,
    updatedWhitelistedValues,
  };
};

interface RollBackOrdersFromTriesParams {
  utf8Names: string[];
  /** The original whitelisted values of the addresses the failed mint touched. */
  whitelistedValuesData: Array<{ address: string; whitelistedValue: WhitelistedValue }>;
  db: Trie;
  whitelistDB: Trie;
}

/**
 * @description Roll back the tries after a mint failed
 */
const rollBackOrdersFromTries = async (
  params: RollBackOrdersFromTriesParams
): Promise<Result<void, Error>> => {
  const { utf8Names, whitelistedValuesData, db, whitelistDB } = params;

  for (const utf8Name of utf8Names) {
    try {
      const value = await db.get(utf8Name);
      if (typeof value !== "undefined" && Buffer.from(value).toString() === MPT_MINTED_VALUE) {
        await db.delete(utf8Name);
        await db.insert(utf8Name, "");
      }
    } catch (error) {
      return Err(new Error(`Failed to roll back "${utf8Name}" : ${convertError(error)}`));
    }
  }

  // v1 wrote a single WhitelistedItem here — not the list the trie holds — corrupting the root.
  for (const { address, whitelistedValue } of whitelistedValuesData) {
    const key = getWhitelistedKey(address);
    const value = Buffer.from(makeWhitelistedValueData(whitelistedValue).toCbor(), "hex");
    const currentValue = await whitelistDB.get(key);
    if (currentValue && currentValue.toString("hex") !== value.toString("hex")) {
      await whitelistDB.delete(key);
      await whitelistDB.insert(key, value);
    }
  }

  return Ok();
};

export type { PrepareMintParams, PreparedMint, RollBackOrdersFromTriesParams };
export { prepareMintTransaction, rollBackOrdersFromTries, sortOrdersForMint };
