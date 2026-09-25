// Chain truth: preview tx 31d9bc7d… is a 7-H.A.L. mint the ledger accepted (built by the Helios engine).
// From its pre-state (fixtures/previewMint.fixture.json.gz: the spent/referenced UTxOs, their scripts,
// the HAL and whitelist tries before the mint) this package's prepareOrders + prepareMintTransaction
// must rebuild the H.A.L. part of that tx byte-for-byte, and the validators must accept it.
// Negative control: the same rebuild over a trie that is missing one minted HAL fails its root check.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";
import { localEvaluator, ratio, valueFromBlockfrost } from "@koralabs/kora-labs-common/txBuild";
import { describe, expect, it } from "vitest";

import {
  Cardano,
  completeTx,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  DeployedScripts,
  getWhitelistedKey,
  inlineDatumOf,
  makeWhitelistedValueData,
  PREFIX_100,
  prepareMintTransaction,
  prepareOrders,
  Serialization,
  Utxo,
  utxoRef,
} from "./v2.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture: any = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/previewMint.fixture.json.gz", import.meta.url))).toString());
const liveTx = Serialization.Transaction.fromCbor(fixture.txCbor);
const live = liveTx.body().toCore();
const liveRedeemers = liveTx.witnessSet().redeemers()!.toCore();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const utxoOf = (input: any): Utxo => {
  const address = input.address as Cardano.PaymentAddress;
  const scriptCbor = input.reference_script_hash ? fixture.scripts[input.reference_script_hash] : undefined;
  return [
    { txId: Cardano.TransactionId(input.tx_hash), index: input.output_index, address },
    {
      address,
      value: valueFromBlockfrost(input.amount),
      ...(input.inline_datum ? { datum: Serialization.PlutusData.fromCbor(input.inline_datum).toCore() } : {}),
      ...(scriptCbor ? { scriptReference: { __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: scriptCbor } as Cardano.Script } : {}),
    },
  ];
};
const holding = (handle: string) => {
  const hex = Buffer.from(handle).toString("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return utxoOf(fixture.inputs.find((i: any) => i.amount.some((a: any) => a.unit.endsWith(hex))));
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const orderUtxo = utxoOf(fixture.inputs.find((i: any) => i.tx_hash.startsWith("10ed234e")));
const settingsUtxo = holding("hal@handle_settings");
const mintingDataUtxo = holding("hal_root@handle_settings");
const settingsV1 = decodeSettingsV1Data(decodeSettingsDatum(inlineDatumOf(settingsUtxo)).data, false);
const mintingTime = (Number(liveTx.body().validityStartInterval()) + 1_666_656_000) * 1000;

const deployed = (type: ScriptType, validatorHash: string, handle: string): [ScriptDetails, Utxo] => {
  const utxo = holding(handle);
  return [{ handle, handleHex: "", type, validatorHash, refScriptUtxo: utxoRef(utxo) } as ScriptDetails, utxo];
};
const [mintProxyScriptDetails, mintProxyScriptTxInput] = deployed(ScriptType.HAL_MINT_PROXY, "171e700eae9a90a34ecbd5c8bbf8caf7e6c71f0d5799d8875cbb93a2", "halmntprx1@handlecontract");
const [mintScriptDetails, mintScriptTxInput] = deployed(ScriptType.HAL_MINT, "608634513520c1ede320bdc04e0eb8877565d21de0e52273632e8fa3", "halmnt1@handlecontract");
const [mintingDataScriptDetails, mintingDataScriptTxInput] = deployed(ScriptType.HAL_MINTING_DATA, "341a868958480a390394cac63853b1a71807cea61d2052fd2d7a8a7d", "halmntmpt1@handlecontract");
const [ordersSpendScriptDetails, ordersSpendScriptTxInput] = deployed(ScriptType.HAL_ORDERS_SPEND, "87b7d83732787c5692a5973dd5b02447406224106ba22763ee8368d6", "halord1@handlecontract");
// Only the four scripts a mint uses are in the fixture; the rest are never touched by prepareMint.
const unused = [{} as ScriptDetails, settingsUtxo] as const;
const deployedScripts: DeployedScripts = {
  mintProxyScriptDetails, mintProxyScriptTxInput, mintScriptDetails, mintScriptTxInput,
  mintingDataScriptDetails, mintingDataScriptTxInput, ordersSpendScriptDetails, ordersSpendScriptTxInput,
  refSpendProxyScriptDetails: unused[0], refSpendProxyScriptTxInput: unused[1],
  refSpendScriptDetails: unused[0], refSpendScriptTxInput: unused[1],
  royaltySpendScriptDetails: unused[0], royaltySpendScriptTxInput: unused[1],
};

const halTrie = (skip?: string) =>
  Trie.fromList(
    (fixture.halTrie as [string, number][])
      .filter(([key]) => key !== skip)
      .map(([key, minted]) => ({ key, value: minted ? "minted" : "" }))
  );
const whitelistTrie = () =>
  Trie.fromList(
    (fixture.whitelist as { bech32Address: string; values: { amount: number; time_gap: number; price: string }[] }[]).map((item) => ({
      key: getWhitelistedKey(item.bech32Address),
      value: Buffer.from(
        makeWhitelistedValueData(item.values.filter((v) => v.amount > 0).sort((a, b) => b.time_gap - a.time_gap).map((v) => ({ ...v, price: BigInt(v.price) }))).toCbor(),
        "hex"
      ),
    }))
  );

// The live tx's reference outputs carry each HAL's CIP-68 datum.
const halDatum = (name: string) => {
  const unit = `${settingsV1.policy_id}${PREFIX_100}${Buffer.from(name).toString("hex")}`;
  const output = live.outputs.find((o) => o.value.assets?.has(unit as Cardano.AssetId))!;
  return Serialization.PlutusData.fromCore(output.datum!);
};

const rebuild = async (db: Trie) => {
  const whitelistDB = await whitelistTrie();
  const orders = await prepareOrders({
    isMainnet: false,
    orderTxInputs: [orderUtxo],
    settingsV1,
    whitelistDB,
    mintingTime,
    maxOrderAmountInOneTx: 7,
    maxTxsPerLambda: 8,
    remainingHals: 9_000,
  });
  if (!orders.ok) throw orders.error;
  const prepared = await prepareMintTransaction({
    isMainnet: false,
    aggregatedOrders: orders.data.aggregatedOrdersList[0],
    assetsInfo: (fixture.mintedInOrder as string[]).map((assetUtf8Name) => ({ assetUtf8Name, assetDatum: halDatum(assetUtf8Name) })),
    db,
    whitelistDB,
    deployedScripts,
    settingsAssetTxInput: settingsUtxo,
    mintingDataAssetTxInput: mintingDataUtxo,
    mintingTime,
  });
  if (!prepared.ok) throw prepared.error;
  return prepared.data;
};

const redeemerOf = (purpose: Cardano.RedeemerPurpose, index: number) =>
  Serialization.PlutusData.fromCore(liveRedeemers.find((r) => r.purpose === purpose && r.index === index)!.data).toCbor();

/** Position of `utxo` among the tx's (ledger-sorted) inputs. */
const inputIndex = (utxo: Utxo) =>
  [...live.inputs].sort((a, b) => (a.txId === b.txId ? a.index - b.index : a.txId < b.txId ? -1 : 1)).findIndex((i) => i.txId === utxo[0].txId && i.index === utxo[0].index);

describe("the live preview mint 31d9bc7d…, rebuilt", () => {
  it("reproduces the minting data spend, order spend, withdrawal and mint redeemers byte-for-byte", async () => {
    const { plan } = await rebuild(await halTrie());
    const [mintingDataSpend, orderSpend] = plan.inputs;
    expect(mintingDataSpend.redeemer!.toCbor()).toBe(redeemerOf(Cardano.RedeemerPurpose.spend, inputIndex(mintingDataUtxo)));
    expect(orderSpend.redeemer!.toCbor()).toBe(redeemerOf(Cardano.RedeemerPurpose.spend, inputIndex(orderUtxo)));
    expect(plan.withdrawals![0].redeemer!.toCbor()).toBe(redeemerOf(Cardano.RedeemerPurpose.withdrawal, 0));
    expect(plan.withdrawals![0].rewardAccount).toBe(live.withdrawals![0].stakeAddress);
    const halPolicy = [...live.mint!.keys()].filter((id) => id.startsWith(settingsV1.policy_id));
    expect([...plan.mint![0].assets.keys()].map((name) => `${settingsV1.policy_id}${name}`).sort()).toEqual(halPolicy.sort());
    expect(plan.requiredSigners).toEqual([settingsV1.allowed_minter]);
    expect(plan.referenceInputs!.every((r) => live.referenceInputs!.some((l) => l.txId === r.txId && l.index === r.index))).toBe(true);
  });

  it("reproduces the minting data output (index 0) and every reference output byte-for-byte", async () => {
    const { mintingDataOutput, referenceOutputs } = await rebuild(await halTrie());
    const bytes = (o: Cardano.TxOut) => Serialization.TransactionOutput.fromCore(o).toCbor();
    expect(bytes(mintingDataOutput)).toBe(bytes(live.outputs[0]));
    const liveRefs = live.outputs.filter((o) => o.address === referenceOutputs[0].address);
    // the live tx topped the (1-lovelace) reference outputs up to min-UTxO; compare at the same coins
    expect(referenceOutputs.map((o, i) => bytes({ ...o, value: { ...o.value, coins: liveRefs[i].value.coins } }))).toEqual(liveRefs.slice(0, referenceOutputs.length).map(bytes));
  });

  it("the validators accept the rebuilt H.A.L. mint (node-equivalent local evaluation)", async () => {
    const { plan } = await rebuild(await halTrie());
    const utxos = (fixture.inputs as unknown[]).map(utxoOf);
    const costModels = new Map([[Cardano.PlutusLanguageVersion.V2, fixture.costModelV2 as number[]]]);
    const built = await completeTx({
      plan,
      network: "preview",
      walletUtxos: [utxoOf(fixture.inputs.find((i: { collateral: boolean }) => i.collateral))],
      changeAddress: settingsV1.payment_address,
      params: {
        minFeeA: BigInt(44), minFeeB: BigInt(155381), priceMemory: ratio("0.0577"), priceSteps: ratio("0.0000721"),
        minFeeRefScriptCostPerByte: ratio(15), coinsPerUtxoByte: BigInt(4310), stakeKeyDeposit: BigInt(2_000_000),
        maxTxSize: 16384, maxTxExUnits: { memory: 17_500_000, steps: 10_000_000_000 }, costModels,
      },
      evaluate: localEvaluator({ utxos, costModels, network: "preview" }),
    });
    const redeemers = Serialization.Transaction.fromCbor(built.cbor as Serialization.TxCBOR).witnessSet().redeemers()!.toCore();
    // minting data + order spends, the HAL policy, the mint withdrawal: every one evaluated
    expect(redeemers.map((r) => r.purpose).sort()).toEqual(["mint", "spend", "spend", "withdrawal"]);
    expect(redeemers.every((r) => r.executionUnits.steps > 0)).toBe(true);
  });

  it("refuses to build over a trie that does not match the on-chain root (negative control)", async () => {
    await expect(rebuild(await halTrie((fixture.halTrie as [string, number][])[0][0]))).rejects.toThrow(/Root Hash mismatch/);
  });
});
