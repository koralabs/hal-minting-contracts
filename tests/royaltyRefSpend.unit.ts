// royalty and ref_spend builders: settings decoding failures, missing-token guards and the built plan.
import { describe, expect, it } from "vitest";

import {
  assetId,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildRoyaltyDatumData,
  buildSettingsData,
  buildSettingsV1Data,
  Cardano,
  constr,
  int,
  mintRoyalty,
  scriptAddress,
  Serialization,
  update,
  updateRoyalty,
  Utxo,
} from "./v2.js";
import { PREFIX_100, ROYALTY_ASSET_FULL_NAME } from "../src/constants/index.js";

const POLICY = "b".repeat(56);
const ADDR = scriptAddress("a".repeat(56), false) as Cardano.PaymentAddress;
const utxo = (n: number, datum?: Serialization.PlutusData, assets?: Map<Cardano.AssetId, bigint>): Utxo => [
  { txId: Cardano.TransactionId(n.toString(16).padStart(64, "0")), index: 0, address: ADDR },
  { address: ADDR, value: { coins: BigInt(2_000_000), assets }, datum: datum?.toCore() },
];
const details = { validatorHash: "e".repeat(56) } as never;
const deployed = {
  mintProxyScriptTxInput: utxo(10),
  mintScriptDetails: details,
  mintScriptTxInput: utxo(11),
  royaltySpendScriptTxInput: utxo(12),
  refSpendProxyScriptTxInput: utxo(13),
  refSpendScriptDetails: details,
  refSpendScriptTxInput: utxo(14),
} as never;

const settingsDatum = buildSettingsData({
  mint_governor: "d".repeat(56),
  mint_version: BigInt(0),
  data: buildSettingsV1Data(
    {
      policy_id: POLICY,
      allowed_minter: "c".repeat(56),
      hal_nft_price: BigInt(10),
      minting_data_script_hash: "d".repeat(56),
      orders_spend_script_hash: "a".repeat(56),
      ref_spend_proxy_script_hash: "f".repeat(56),
      ref_spend_governor: "0".repeat(56),
      ref_spend_admin: "c".repeat(56),
      royalty_spend_script_hash: "9".repeat(56),
      minting_start_time: 1,
      payment_address: ADDR,
    },
    false
  ),
});
const royaltyDatum = { recipients: [], version: 1, extra: int(0) };

describe("royalty builders", () => {
  it("mints the royalty token to the royalty_spend address, signed by the allowed minter", async () => {
    const r = await mintRoyalty({ isMainnet: false, royaltyDatum, deployedScripts: deployed, settingsAssetTxInput: utxo(1, settingsDatum) });
    if (!r.ok) throw r.error;
    expect(r.data.requiredSigners).toEqual(["c".repeat(56)]);
    expect(r.data.mint?.[0].policyId).toBe(POLICY);
    expect(r.data.outputs[0].address).toBe(scriptAddress("9".repeat(56), false));
  });

  it("refuses a settings utxo with no inline datum (negative control: valid settings succeed above)", async () => {
    const r = await mintRoyalty({ isMainnet: false, royaltyDatum, deployedScripts: deployed, settingsAssetTxInput: utxo(1) });
    expect(!r.ok && r.error.message).toContain("Failed to decode settings:");
  });

  it("refuses settings whose v1 payload is malformed", async () => {
    const bad = buildSettingsData({ mint_governor: "d".repeat(56), mint_version: BigInt(0), data: constr(0, []) });
    const r = await mintRoyalty({ isMainnet: false, royaltyDatum, deployedScripts: deployed, settingsAssetTxInput: utxo(1, bad) });
    expect(!r.ok && r.error.message).toContain("Failed to decode settings v1:");
  });

  it("updates the royalty datum only when the input holds the royalty token", async () => {
    const token = new Map([[assetId(POLICY, ROYALTY_ASSET_FULL_NAME), BigInt(1)]]);
    const params = { isMainnet: false, newRoyaltyDatum: royaltyDatum, deployedScripts: deployed, settingsAssetTxInput: utxo(1, settingsDatum), royaltySpendAdmin: "ad".repeat(28) };
    const ok = await updateRoyalty({ ...params, royaltyTxInput: utxo(2, buildRoyaltyDatumData(royaltyDatum), token) });
    if (!ok.ok) throw ok.error;
    expect(ok.data.requiredSigners).toEqual(["ad".repeat(28)]);
    const missing = await updateRoyalty({ ...params, royaltyTxInput: utxo(2) });
    expect(!missing.ok && missing.error.message).toBe("Royalty Token not found in RoyaltyTxInput");
    const noSettings = await updateRoyalty({ ...params, royaltyTxInput: utxo(2), settingsAssetTxInput: utxo(1) });
    expect(!noSettings.ok && noSettings.error.message).toContain("Failed to decode settings:");
  });
});

describe("ref_spend update", () => {
  const refSettings = buildRefSpendSettingsData({
    ref_spend_governor: "0".repeat(56),
    data: buildRefSpendSettingsV1Data({ policy_id: POLICY, ref_spend_admin: "c".repeat(56) }),
  });
  const name = "6162";
  const params = (over: Record<string, unknown> = {}) => ({
    isMainnet: false,
    assetUtf8Name: "ab",
    refTxInput: utxo(2, int(0), new Map([[assetId(POLICY, `${PREFIX_100}${name}`), BigInt(1)]])),
    newDatum: int(5),
    deployedScripts: deployed,
    refSpendSettingsAssetTxInput: utxo(1, refSettings),
    ...over,
  });

  it("rewrites the reference asset datum, signed by the ref_spend admin", async () => {
    const r = await update(params() as never);
    if (!r.ok) throw r.error;
    expect(r.data.requiredSigners).toEqual(["c".repeat(56)]);
    expect(r.data.outputs[0].datum).toEqual(int(5).toCore());
  });

  it("refuses when the reference asset is not in the input", async () => {
    const r = await update(params({ refTxInput: utxo(2) }) as never);
    expect(!r.ok && r.error.message).toBe("Reference asset not found.");
  });

  it("refuses settings with no datum or a malformed v1 payload", async () => {
    const none = await update(params({ refSpendSettingsAssetTxInput: utxo(1) }) as never);
    expect(!none.ok && none.error.message).toContain("Failed to decode ref spend settings:");
    const bad = await update(params({ refSpendSettingsAssetTxInput: utxo(1, buildRefSpendSettingsData({ ref_spend_governor: "0".repeat(56), data: constr(0, []) })) }) as never);
    expect(!bad.ok && bad.error.message).toContain("Failed to decode ref spend settings v1:");
  });
});
