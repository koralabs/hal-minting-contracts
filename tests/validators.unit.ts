// The HAL validators executing transactions built by this package, on a full ledger (scalus's
// emulator: balance, fees, signatures, validity interval and every script). Successor of the v1 Helios
// emulator suite (tests/mint.test.ts): the same scenarios, each with the negative control that proves
// the validator — not the builder — is what accepts or refuses.
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";
import { beforeAll, describe, expect, it } from "vitest";

import { baseAddress, genesisUtxo, Key, Ledger, makeKey } from "./harness.js";
import {
  assetId,
  buildContracts,
  buildMintingData,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildRoyaltyFlagCIP68ExtraData,
  buildSettingsData,
  buildSettingsV1Data,
  bytes,
  cancel,
  Cardano,
  constr,
  decodeMintingDataDatum,
  decodeOrderDatumData,
  DeployedScripts,
  fromCbor,
  getWhitelistedKey,
  HalTxPlan,
  inlineDatumOf,
  int,
  LEGACY_POLICY_ID,
  makeWhitelistedValueData,
  mintRoyalty,
  PlutusData,
  PREFIX_100,
  PREFIX_222,
  prepareMintTransaction,
  prepareOrders,
  refund,
  registerStakingAddresses,
  request,
  rollBackOrdersFromTries,
  ROYALTY_ASSET_FULL_NAME,
  RoyaltyDatum,
  scriptAddress,
  Serialization,
  SettingsV1,
  update,
  updateRoyalty,
  Utxo,
  utxoRef,
  WhitelistedValue,
} from "./v2.js";

const HOUR = 60 * 60 * 1000;
// A validator refusing shows up at evaluation (building) or, failing that, at submission.
const REJECTED = /validator rejected|ledger rejected/;
const PRICE = BigInt(180_000_000);
const WL_PRICE_1 = BigInt(150_000_000);
const WL_PRICE_2 = BigInt(160_000_000);
const MINTING_START = Date.UTC(2026, 8, 1);
const ADA = (n: number) => BigInt(n * 1_000_000);
const handleUnit = (name: string) => assetId(LEGACY_POLICY_ID, `${PREFIX_222}${Buffer.from(name).toString("hex")}`);

interface Wallet {
  key: Key;
  address: string;
}

const halDatum = (name: string): PlutusData => {
  const metadata = new Serialization.PlutusMap();
  metadata.insert(bytes(Buffer.from("name")), bytes(Buffer.from(name)));
  return constr(0, [Serialization.PlutusData.newMap(metadata), int(1), buildRoyaltyFlagCIP68ExtraData()]);
};

const env = {} as {
  ledger: Ledger;
  admin: Wallet;
  minter: Wallet;
  refAdmin: Wallet;
  royaltyAdmin: Wallet;
  payment: Wallet;
  users: Wallet[];
  whitelisted: Wallet;
  settingsV1: SettingsV1;
  deployedScripts: DeployedScripts;
  db: Trie;
  whitelistDB: Trie;
  settingsUtxo: Utxo;
  refSpendSettingsUtxo: Utxo;
};

const wallet = async (seed: number): Promise<Wallet> => {
  const key = await makeKey(seed);
  return { key, address: baseAddress(key) };
};

const mintingDataUtxo = () => env.ledger.at(scriptAddress(env.settingsV1.minting_data_script_hash, false))[0];
const orderUtxos = () => env.ledger.at(scriptAddress(env.settingsV1.orders_spend_script_hash, false));
const ordersOf = (user: Wallet) =>
  orderUtxos().filter((utxo) => {
    try {
      return decodeOrderDatumData(inlineDatumOf(utxo), false).destination_address === user.address;
    } catch {
      return false;
    }
  });

/** Order `amount` HALs for `user`, paying `cost`. */
const placeOrder = async (user: Wallet, amount: number, cost: bigint) => {
  const settings = { mint_governor: "", mint_version: BigInt(0), data: buildSettingsV1Data(env.settingsV1) };
  const plan = await request({ isMainnet: false, orders: [{ destinationAddress: user.address, amount, cost }], settings, maxOrderAmountInOneTx: 10 });
  if (!plan.ok) throw plan.error;
  return env.ledger.submit(plan.data, user);
};

/** Prepare, complete and submit a mint of every processable order, with HAL names `names`. */
const mint = async (names: string[], mintingTime: number, tamper: (plan: HalTxPlan) => HalTxPlan = (p) => p) => {
  env.ledger.setTime(mintingTime);
  const prepared = await prepareOrders({
    isMainnet: false,
    orderTxInputs: orderUtxos(),
    settingsV1: env.settingsV1,
    whitelistDB: env.whitelistDB,
    mintingTime,
    maxOrderAmountInOneTx: 10,
    maxTxsPerLambda: 1,
    remainingHals: 10_000,
  });
  if (!prepared.ok) throw prepared.error;
  const [aggregatedOrders = []] = prepared.data.aggregatedOrdersList;
  const result = await prepareMintTransaction({
    isMainnet: false,
    aggregatedOrders,
    assetsInfo: names.map((assetUtf8Name) => ({ assetUtf8Name, assetDatum: halDatum(assetUtf8Name) })),
    db: env.db,
    whitelistDB: env.whitelistDB,
    deployedScripts: env.deployedScripts,
    settingsAssetTxInput: env.settingsUtxo,
    mintingDataAssetTxInput: mintingDataUtxo(),
    mintingTime,
  });
  if (!result.ok) throw result.error;
  const submitted = await env.ledger.submit(tamper(result.data.plan), env.minter, [env.minter.key], env.settingsV1.payment_address);
  return { prepared: prepared.data, ...result.data, ...submitted };
};

/** Undo a rejected mint's trie updates (the builder mutates the tries before submission). */
const rollBack = async (utf8Names: string[]) => {
  const result = await rollBackOrdersFromTries({ utf8Names, whitelistedValuesData: [], db: env.db, whitelistDB: env.whitelistDB });
  if (!result.ok) throw result.error;
};

const assetsAt = (address: string) =>
  env.ledger.at(address).flatMap(([, output]) => [...(output.value.assets ?? new Map()).keys()]);

beforeAll(async () => {
  env.admin = await wallet(1);
  env.minter = await wallet(2);
  env.refAdmin = await wallet(3);
  env.royaltyAdmin = await wallet(4);
  env.payment = await wallet(5);
  env.users = await Promise.all([10, 11, 12].map(wallet));
  env.whitelisted = await wallet(20);
  const vault = await wallet(99);

  const contracts = buildContracts({
    isMainnet: false,
    mint_version: BigInt(0),
    admin_verification_key_hash: env.admin.key.keyHash,
    orders_spend_randomizer: "",
    royalty_spend_admin: env.royaltyAdmin.key.keyHash,
  });
  env.settingsV1 = {
    policy_id: contracts.halPolicyHash,
    allowed_minter: env.minter.key.keyHash,
    hal_nft_price: PRICE,
    minting_data_script_hash: contracts.mintingData.mintingDataValidatorHash,
    orders_spend_script_hash: contracts.ordersSpend.ordersSpendValidatorHash,
    ref_spend_proxy_script_hash: contracts.refSpendProxy.refSpendProxyValidatorHash,
    ref_spend_governor: contracts.refSpend.refSpendValidatorHash,
    ref_spend_admin: env.refAdmin.key.keyHash,
    royalty_spend_script_hash: contracts.royaltySpend.royaltySpendValidatorHash,
    minting_start_time: MINTING_START,
    payment_address: env.payment.address,
  };

  env.db = await Trie.fromList(Array.from({ length: 200 }, (_, i) => ({ key: `hal-${i + 1}`, value: "" })));
  const whitelisted: WhitelistedValue = [
    { time_gap: 2 * HOUR, amount: 10, price: WL_PRICE_1 },
    { time_gap: HOUR, amount: 5, price: WL_PRICE_2 },
  ];
  env.whitelistDB = await Trie.fromList([
    { key: getWhitelistedKey(env.whitelisted.address), value: Buffer.from(makeWhitelistedValueData(whitelisted).toCbor(), "hex") },
  ]);

  const script = (cbor: string): Cardano.Script => ({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: cbor as never });
  const refScriptUtxo = (cbor: string) =>
    genesisUtxo({ address: vault.address as Cardano.PaymentAddress, value: { coins: ADA(60) }, scriptReference: script(cbor) });
  const deployed = (type: ScriptType, hash: string, utxo: Utxo): [ScriptDetails, Utxo] => [
    { handle: "", handleHex: "", type, validatorHash: hash, refScriptUtxo: utxoRef(utxo) } as ScriptDetails,
    utxo,
  ];
  const [mintProxyScriptDetails, mintProxyScriptTxInput] = deployed(ScriptType.HAL_MINT_PROXY, contracts.halPolicyHash, refScriptUtxo(contracts.mintProxy.mintProxyMintScript.cbor));
  const [mintScriptDetails, mintScriptTxInput] = deployed(ScriptType.HAL_MINT, contracts.mint.mintValidatorHash, refScriptUtxo(contracts.mint.mintWithdrawScript.cbor));
  const [mintingDataScriptDetails, mintingDataScriptTxInput] = deployed(ScriptType.HAL_MINTING_DATA, contracts.mintingData.mintingDataValidatorHash, refScriptUtxo(contracts.mintingData.mintingDataSpendScript.cbor));
  const [ordersSpendScriptDetails, ordersSpendScriptTxInput] = deployed(ScriptType.HAL_ORDERS_SPEND, contracts.ordersSpend.ordersSpendValidatorHash, refScriptUtxo(contracts.ordersSpend.ordersSpendScript.cbor));
  const [refSpendProxyScriptDetails, refSpendProxyScriptTxInput] = deployed(ScriptType.HAL_REF_SPEND_PROXY, contracts.refSpendProxy.refSpendProxyValidatorHash, refScriptUtxo(contracts.refSpendProxy.refSpendProxyScript.cbor));
  const [refSpendScriptDetails, refSpendScriptTxInput] = deployed(ScriptType.HAL_REF_SPEND, contracts.refSpend.refSpendValidatorHash, refScriptUtxo(contracts.refSpend.refSpendScript.cbor));
  const [royaltySpendScriptDetails, royaltySpendScriptTxInput] = deployed(ScriptType.HAL_ROYALTY_SPEND, contracts.royaltySpend.royaltySpendValidatorHash, refScriptUtxo(contracts.royaltySpend.royaltySpendScript.cbor));
  env.deployedScripts = {
    mintProxyScriptDetails, mintProxyScriptTxInput, mintScriptDetails, mintScriptTxInput,
    mintingDataScriptDetails, mintingDataScriptTxInput, ordersSpendScriptDetails, ordersSpendScriptTxInput,
    refSpendProxyScriptDetails, refSpendProxyScriptTxInput, refSpendScriptDetails, refSpendScriptTxInput,
    royaltySpendScriptDetails, royaltySpendScriptTxInput,
  };

  env.settingsUtxo = genesisUtxo({
    address: env.admin.address as Cardano.PaymentAddress,
    value: { coins: ADA(5), assets: new Map([[handleUnit("hal@handle_settings"), BigInt(1)]]) },
    datum: buildSettingsData({ mint_governor: contracts.mint.mintValidatorHash, mint_version: BigInt(0), data: buildSettingsV1Data(env.settingsV1) }).toCore(),
  });
  env.refSpendSettingsUtxo = genesisUtxo({
    address: env.admin.address as Cardano.PaymentAddress,
    value: { coins: ADA(5), assets: new Map([[handleUnit("hal_pz@handle_settings"), BigInt(1)]]) },
    datum: buildRefSpendSettingsData({
      ref_spend_governor: contracts.refSpend.refSpendValidatorHash,
      data: buildRefSpendSettingsV1Data({ policy_id: contracts.halPolicyHash, ref_spend_admin: env.refAdmin.key.keyHash }),
    }).toCore(),
  });
  const mintingData = genesisUtxo({
    address: contracts.mintingData.mintingDataValidatorAddress as Cardano.PaymentAddress,
    value: { coins: ADA(5), assets: new Map([[handleUnit("hal_root@handle_settings"), BigInt(1)]]) },
    datum: buildMintingData({ mpt_root_hash: env.db.hash.toString("hex"), whitelist_mpt_root_hash: env.whitelistDB.hash.toString("hex") }).toCore(),
  });
  const funds = [env.admin, env.minter, env.refAdmin, env.royaltyAdmin, ...env.users, env.whitelisted].flatMap((w) =>
    [0, 1].map(() => genesisUtxo({ address: w.address as Cardano.PaymentAddress, value: { coins: ADA(5_000) } }))
  );

  env.ledger = new Ledger(
    [env.settingsUtxo, env.refSpendSettingsUtxo, mintingData, ...Object.values(env.deployedScripts).filter(Array.isArray) as Utxo[], ...funds],
    MINTING_START - 3 * HOUR
  );

  // The withdrawal validators' staking addresses must be registered before they can authorize anything.
  await env.ledger.submit(registerStakingAddresses([contracts.mint.mintStakingAddress, contracts.refSpend.refSpendStakingAddress]), env.admin);
});

describe("HAL validators on a ledger", () => {
  it("rejects a non-whitelisted order before minting_start_time (it is refunded, not minted)", async () => {
    await placeOrder(env.users[0], 3, PRICE * BigInt(3));
    const prepared = await prepareOrders({
      isMainnet: false,
      orderTxInputs: orderUtxos(),
      settingsV1: env.settingsV1,
      whitelistDB: env.whitelistDB,
      mintingTime: MINTING_START - HOUR,
      maxOrderAmountInOneTx: 10,
      maxTxsPerLambda: 1,
      remainingHals: 10_000,
    });
    expect(prepared.ok && prepared.data.aggregatedOrdersList).toEqual([]);
    expect(prepared.ok && prepared.data.invalidOrderTxInputs).toHaveLength(1);
  });

  it("mints 3 HALs after minting_start_time: user gets the 222s, the ref proxy the 100s, payment the price", async () => {
    const paidBefore = env.ledger.at(env.payment.address).reduce((s, [, o]) => s + o.value.coins, BigInt(0));
    const { userOutputsData, body } = await mint(["hal-1", "hal-2", "hal-3"], MINTING_START + HOUR);
    expect(userOutputsData[0].destinationAddress).toBe(env.users[0].address);
    const userAssets = assetsAt(env.users[0].address);
    for (const name of ["hal-1", "hal-2", "hal-3"]) {
      const hex = Buffer.from(name).toString("hex");
      expect(userAssets).toContain(assetId(env.settingsV1.policy_id, `${PREFIX_222}${hex}`));
      expect(assetsAt(scriptAddress(env.settingsV1.ref_spend_proxy_script_hash, false))).toContain(assetId(env.settingsV1.policy_id, `${PREFIX_100}${hex}`));
    }
    const paidAfter = env.ledger.at(env.payment.address).reduce((s, [, o]) => s + o.value.coins, BigInt(0));
    // the orders' payment, less the fee and the HAL outputs' min-UTxO (the minting data output
    // carries its own coins through), reaches payment_address as change
    const [, ...halOutputs] = body.outputs.slice(0, -1);
    const halOutputsLovelace = halOutputs.reduce((sum, o) => sum + o.value.coins, BigInt(0));
    expect(body.outputs.at(-1)!.address).toBe(env.payment.address);
    expect(paidAfter - paidBefore).toBe(PRICE * BigInt(3) - body.fee - halOutputsLovelace);
    expect(decodeMintingDataDatum(inlineDatumOf(mintingDataUtxo())).mpt_root_hash).toBe(env.db.hash.toString("hex"));
  });

  it("refuses a mint whose HAL goes to someone else (validator, not builder)", async () => {
    await placeOrder(env.users[1], 1, PRICE);
    const thief = env.users[2].address as Cardano.PaymentAddress;
    await expect(
      mint(["hal-4"], env.ledger.now + 1000, (plan) => ({
        ...plan,
        outputs: plan.outputs.map((o) => (o.address === env.users[1].address ? { ...o, address: thief } : o)),
      }))
    ).rejects.toThrow(REJECTED);
    await rollBack(["hal-4"]);
    // the untampered mint of the same order goes through
    await mint(["hal-4"], env.ledger.now + 1000);
    expect(assetsAt(env.users[1].address)).toContain(assetId(env.settingsV1.policy_id, `${PREFIX_222}${Buffer.from("hal-4").toString("hex")}`));
  });

  it("refuses a HAL name that is not pre-defined in the MPT (builder) and a proof for another name (validator)", async () => {
    await placeOrder(env.users[1], 1, PRICE);
    await expect(mint(["no-hal"], env.ledger.now + 1000)).rejects.toThrow(/Asset name is not pre-defined: no-hal/);
    // mint hal-5's proof but a different token name: the minting data validator must refuse
    const other = assetId(env.settingsV1.policy_id, `${PREFIX_222}${Buffer.from("hal-6").toString("hex")}`);
    await expect(
      mint(["hal-5"], env.ledger.now + 1000, (plan) => ({
        ...plan,
        mint: plan.mint!.map((m) => ({ ...m, assets: new Map([...m.assets].map(([k, v]) => [k.startsWith(PREFIX_222) ? other.slice(56) : k, v])) })),
        outputs: plan.outputs.map((o) => (o.address === env.users[1].address ? { ...o, value: { coins: o.value.coins, assets: new Map([[other, BigInt(1)]]) } } : o)),
      }))
    ).rejects.toThrow(REJECTED);
    await rollBack(["hal-5"]);
    await mint(["hal-5"], env.ledger.now + 1000);
  });

  it("mints for a whitelisted address an hour early at the whitelisted price, and not below it", async () => {
    const early = MINTING_START - HOUR;
    env.ledger.setTime(early - 60_000);
    // 5 at the first tier price is the least the validator accepts
    await placeOrder(env.whitelisted, 5, WL_PRICE_1 * BigInt(5));
    const { txId } = await mint(["hal-10", "hal-11", "hal-12", "hal-13", "hal-14"], early);
    expect(txId).toMatch(/^[0-9a-f]{64}$/);
    expect(assetsAt(env.whitelisted.address).filter((a) => a.startsWith(env.settingsV1.policy_id))).toHaveLength(5);
    // an under-priced whitelisted order is refused by prepareOrders
    await placeOrder(env.whitelisted, 2, WL_PRICE_1 * BigInt(2) - BigInt(1));
    const prepared = await prepareOrders({
      isMainnet: false,
      orderTxInputs: orderUtxos(),
      settingsV1: env.settingsV1,
      whitelistDB: env.whitelistDB,
      mintingTime: env.ledger.now + 1000,
      maxOrderAmountInOneTx: 10,
      maxTxsPerLambda: 1,
      remainingHals: 10_000,
    });
    expect(prepared.ok && prepared.data.invalidOrderTxInputs).toHaveLength(1);
  });

  it("mints for several users in one tx (orders in destination order)", async () => {
    env.ledger.setTime(MINTING_START + 2 * HOUR);
    // leave only fresh orders
    for (const order of orderUtxos()) {
      const plan = await refund({ isMainnet: false, orderTxInput: order, refundingAddress: env.whitelisted.address, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo });
      if (plan.ok) await env.ledger.submit(plan.data, env.minter, [env.minter.key], env.whitelisted.address);
    }
    for (const user of env.users) await placeOrder(user, 2, PRICE * BigInt(2));
    const { userOutputsData } = await mint(["hal-20", "hal-21", "hal-22", "hal-23", "hal-24", "hal-25"], MINTING_START + 2 * HOUR);
    expect(new Set(userOutputsData.map((u) => u.destinationAddress))).toEqual(new Set(env.users.map((u) => u.address)));
  });

  it("cancels an order signed by its owner, and not one signed by someone else", async () => {
    await placeOrder(env.users[0], 1, PRICE);
    const [order] = ordersOf(env.users[0]);
    const plan = await cancel({ isMainnet: false, address: env.users[0].address, orderTxInput: order, deployedScripts: env.deployedScripts });
    if (!plan.ok) throw plan.error;
    await expect(env.ledger.submit({ ...plan.data, requiredSigners: [env.users[1].key.keyHash] }, env.users[1], [env.users[1].key])).rejects.toThrow(REJECTED);
    await env.ledger.submit(plan.data, env.users[0], [env.users[0].key]);
    expect(ordersOf(env.users[0])).toHaveLength(0);
  });

  it("refuses to cancel two orders in one transaction", async () => {
    await placeOrder(env.users[0], 1, PRICE);
    await placeOrder(env.users[0], 1, PRICE);
    const [a, b] = await Promise.all(ordersOf(env.users[0]).map((order) => cancel({ isMainnet: false, address: env.users[0].address, orderTxInput: order, deployedScripts: env.deployedScripts })));
    if (!a.ok || !b.ok) throw new Error("cancel plans");
    await expect(env.ledger.submit({ ...a.data, inputs: [...a.data.inputs, ...b.data.inputs] }, env.users[0], [env.users[0].key])).rejects.toThrow(REJECTED);
  });

  it("refunds one order to its owner (allowed minter signs); refuses two at once and an unsigned one", async () => {
    const [a, b] = ordersOf(env.users[0]);
    const planA = await refund({ isMainnet: false, orderTxInput: a, refundingAddress: env.users[0].address, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo });
    const planB = await refund({ isMainnet: false, orderTxInput: b, refundingAddress: env.users[0].address, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo });
    if (!planA.ok || !planB.ok) throw new Error("refund plans");
    await expect(env.ledger.submit({ ...planA.data, inputs: [...planA.data.inputs, ...planB.data.inputs] }, env.minter, [env.minter.key], env.users[0].address)).rejects.toThrow(REJECTED);
    await expect(env.ledger.submit({ ...planA.data, requiredSigners: [] }, env.minter, [], env.users[0].address)).rejects.toThrow(REJECTED);
    expect((await refund({ isMainnet: false, orderTxInput: a, refundingAddress: env.users[1].address, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo })).ok).toBe(false);
    await env.ledger.submit(planA.data, env.minter, [env.minter.key], env.users[0].address);
    await env.ledger.submit(planB.data, env.minter, [env.minter.key], env.users[0].address);
    expect(ordersOf(env.users[0])).toHaveLength(0);
  });

  it("refunds an order whose datum is not an OrderDatum", async () => {
    const ordersAddress = scriptAddress(env.settingsV1.orders_spend_script_hash, false) as Cardano.PaymentAddress;
    await env.ledger.submit(
      { inputs: [], outputs: [{ address: ordersAddress, value: { coins: ADA(20) }, datum: fromCbor("d87980").toCore() }], plutusLanguages: [], referenceScriptBytes: 0 },
      env.users[2]
    );
    const [order] = orderUtxos().filter((utxo) => inlineDatumOf(utxo)?.toCbor() === "d87980");
    const plan = await refund({ isMainnet: false, orderTxInput: order, refundingAddress: env.users[2].address, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo });
    if (!plan.ok) throw plan.error;
    await env.ledger.submit(plan.data, env.minter, [env.minter.key], env.users[2].address);
    expect(orderUtxos().filter((utxo) => inlineDatumOf(utxo)?.toCbor() === "d87980")).toHaveLength(0);
  });

  it("updates a HAL's reference datum with the ref-spend admin's signature, and not without it", async () => {
    const hex = Buffer.from("hal-1").toString("hex");
    const refUnit = assetId(env.settingsV1.policy_id, `${PREFIX_100}${hex}`);
    const refUtxo = env.ledger.at(scriptAddress(env.settingsV1.ref_spend_proxy_script_hash, false)).find(([, o]) => o.value.assets?.has(refUnit))!;
    const plan = await update({ isMainnet: false, assetUtf8Name: "hal-1", refTxInput: refUtxo, newDatum: halDatum("hal-1 (updated)"), deployedScripts: env.deployedScripts, refSpendSettingsAssetTxInput: env.refSpendSettingsUtxo });
    if (!plan.ok) throw plan.error;
    await expect(env.ledger.submit({ ...plan.data, requiredSigners: [env.users[0].key.keyHash] }, env.users[0], [env.users[0].key])).rejects.toThrow(REJECTED);
    await env.ledger.submit(plan.data, env.refAdmin, [env.refAdmin.key]);
    const updated = env.ledger.at(scriptAddress(env.settingsV1.ref_spend_proxy_script_hash, false)).find(([, o]) => o.value.assets?.has(refUnit))!;
    expect(inlineDatumOf(updated)!.toCbor()).toBe(halDatum("hal-1 (updated)").toCbor());
  });

  it("mints the royalty token (allowed minter) and updates it (royalty admin), refusing an update by anyone else", async () => {
    const royaltyDatum: RoyaltyDatum = {
      recipients: [{ address: env.payment.address, fee: 5, min_fee: ADA(1), max_fee: undefined }],
      version: 1,
      extra: buildRoyaltyFlagCIP68ExtraData(),
    };
    const minted = await mintRoyalty({ isMainnet: false, royaltyDatum, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo });
    if (!minted.ok) throw minted.error;
    await env.ledger.submit(minted.data, env.minter, [env.minter.key]);
    const royaltyAddress = scriptAddress(env.settingsV1.royalty_spend_script_hash, false);
    const [royaltyUtxo] = env.ledger.at(royaltyAddress);
    expect(royaltyUtxo[1].value.assets?.has(assetId(env.settingsV1.policy_id, ROYALTY_ASSET_FULL_NAME))).toBe(true);

    const params = { isMainnet: false, royaltyTxInput: royaltyUtxo, newRoyaltyDatum: { ...royaltyDatum, version: 2 }, deployedScripts: env.deployedScripts, settingsAssetTxInput: env.settingsUtxo };
    const byStranger = await updateRoyalty({ ...params, royaltySpendAdmin: env.users[0].key.keyHash });
    if (!byStranger.ok) throw byStranger.error;
    await expect(env.ledger.submit(byStranger.data, env.users[0], [env.users[0].key])).rejects.toThrow(REJECTED);
    const byAdmin = await updateRoyalty({ ...params, royaltySpendAdmin: env.royaltyAdmin.key.keyHash });
    if (!byAdmin.ok) throw byAdmin.error;
    await env.ledger.submit(byAdmin.data, env.royaltyAdmin, [env.royaltyAdmin.key]);
    expect(env.ledger.at(royaltyAddress)).toHaveLength(1);
  });
});
