// Off-chain behaviour of the builders and helpers: order validation/aggregation, guards, rate limits,
// slot arithmetic and wallet completion. (Validator acceptance is in validators.unit.ts.)
import { createRequire } from "node:module";

import { resetRateLimits } from "@koralabs/kora-labs-common/chain";
import { ratio } from "@koralabs/kora-labs-common/txBuild";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOrderDatumData,
  buildSettingsV1Data,
  Cardano,
  checkAccountRegistrationStatus,
  completeTx,
  constr,
  fromCbor,
  getWhitelistedKey,
  HalTxPlan,
  isOrderTxInputValid,
  makeWhitelistedValueData,
  orderToConsecutiveSum7,
  parseMPTProofJSON,
  posixMsFromSlot,
  prepareOrders,
  refund,
  registerStakingAddresses,
  request,
  scriptAddress,
  Serialization,
  SettingsV1,
  slotFromPosixMs,
  Utxo,
} from "./v2.js";

const ORDERS_HASH = "a".repeat(56);
const ORDERS_ADDRESS = scriptAddress(ORDERS_HASH, false) as Cardano.PaymentAddress;
const keyAddress = (hex: string) =>
  Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { type: Cardano.CredentialType.KeyHash, hash: hex.repeat(56) as Cardano.Credential["hash"] },
    { type: Cardano.CredentialType.KeyHash, hash: "e".repeat(56) as Cardano.Credential["hash"] }
  )
    .toAddress()
    .toBech32();
const USER_1 = keyAddress("1");
const USER_2 = keyAddress("2");

const settingsV1 = (overrides: Partial<SettingsV1> = {}): SettingsV1 => ({
  policy_id: "b".repeat(56),
  allowed_minter: "c".repeat(56),
  hal_nft_price: BigInt(10),
  minting_data_script_hash: "d".repeat(56),
  orders_spend_script_hash: ORDERS_HASH,
  ref_spend_proxy_script_hash: "f".repeat(56),
  ref_spend_governor: "0".repeat(56),
  ref_spend_admin: "c".repeat(56),
  royalty_spend_script_hash: "9".repeat(56),
  minting_start_time: 2_000,
  payment_address: USER_2,
  ...overrides,
});

let n = 0;
const order = (amount: number, lovelace: bigint, destination = USER_1, address = ORDERS_ADDRESS): Utxo => {
  n++;
  return [
    { txId: Cardano.TransactionId(n.toString(16).padStart(64, "0")), index: 0, address },
    { address, value: { coins: lovelace }, datum: buildOrderDatumData({ owner_key_hash: "1".repeat(56), destination_address: destination, amount }).toCore() },
  ];
};

const noWhitelist = { get: vi.fn(async () => undefined) };
const prepare = (orderTxInputs: Utxo[], overrides: Record<string, unknown> = {}) =>
  prepareOrders({
    isMainnet: false,
    orderTxInputs,
    settingsV1: settingsV1(),
    whitelistDB: noWhitelist as never,
    mintingTime: 3_000,
    maxOrderAmountInOneTx: 3,
    maxTxsPerLambda: 2,
    remainingHals: 10,
    ...overrides,
  });

describe("prepareOrders (ported v1 scenarios)", () => {
  it("orderToConsecutiveSum7 groups orders into sevens while preserving order", () => {
    const orders = [1, 2, 4, 3, 6, 1, 8].map((amount) => ({ datum: { amount } }));
    expect(orderToConsecutiveSum7(orders).map(({ datum }) => datum.amount)).toEqual([1, 6, 2, 4, 1, 3, 8]);
  });

  it("separates valid, unpicked and invalid orders (not enough HALs left)", async () => {
    const orders = [order(2, BigInt(20)), order(1, BigInt(10)), order(3, BigInt(30))];
    const result = await prepare(orders, { maxTxsPerLambda: 1, remainingHals: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.aggregatedOrdersList).toHaveLength(1);
    expect(result.data.aggregatedOrdersList[0][0].amount).toBe(3);
    expect(result.data.unpickedOrderTxInputs).toHaveLength(0);
    expect(result.data.invalidOrderTxInputs).toEqual([orders[2]]);
  });

  it("leaves later valid orders unpicked at the lambda limit, aggregating by destination", async () => {
    const unpicked = order(1, BigInt(11));
    const result = await prepare([order(1, BigInt(10)), order(1, BigInt(10), USER_2), unpicked], { maxOrderAmountInOneTx: 2, maxTxsPerLambda: 1 });
    if (!result.ok) throw result.error;
    expect(result.data.aggregatedOrdersList[0].map((o) => o.destinationAddress)).toEqual([USER_1, USER_2]);
    expect(result.data.unpickedOrderTxInputs).toEqual([unpicked]);
    expect(result.data.invalidOrderTxInputs).toHaveLength(0);
  });

  it("rejects underfunded public orders", async () => {
    const under = order(2, BigInt(19));
    const result = await prepare([under]);
    if (!result.ok) throw result.error;
    expect(result.data.aggregatedOrdersList).toHaveLength(0);
    expect(result.data.invalidOrderTxInputs).toEqual([under]);
    expect(Object.values(result.data.invalidOrderReasons)[0]).toMatch(/need 20 but has only 19/);
  });

  it("refunds non-whitelisted orders placed before the public mint", async () => {
    const early = order(1, BigInt(10));
    const result = await prepare([early], { settingsV1: settingsV1({ minting_start_time: 3_000 }), mintingTime: 2_000 });
    if (!result.ok) throw result.error;
    expect(result.data.invalidOrderTxInputs).toEqual([early]);
  });

  it("marks a mixed whitelist + public-price order for a whitelist proof", async () => {
    const whitelistDB = { get: vi.fn(async () => Buffer.from(makeWhitelistedValueData([{ time_gap: 0, amount: 1, price: BigInt(5) }]).toCbor(), "hex")) };
    const mixed = order(2, BigInt(15));
    const result = await prepare([mixed], { whitelistDB });
    if (!result.ok) throw result.error;
    expect(whitelistDB.get).toHaveBeenCalledWith(getWhitelistedKey(USER_1));
    expect(result.data.aggregatedOrdersList[0][0]).toMatchObject({ amount: 2, needWhitelistProof: true, orderTxInputs: [mixed] });
  });

  it("lists orders at the wrong address, with zero or too many HALs, or no OrderDatum as invalid", async () => {
    const wrongAddress = order(1, BigInt(10), USER_1, scriptAddress("b".repeat(56), false) as Cardano.PaymentAddress);
    const zero = order(0, BigInt(10));
    const tooMany = order(4, BigInt(40));
    const noDatum: Utxo = [{ ...order(1, BigInt(10))[0] }, { address: ORDERS_ADDRESS, value: { coins: BigInt(10) }, datum: constr(0).toCore() }];
    const valid = order(1, BigInt(10));
    const result = await prepare([wrongAddress, zero, tooMany, noDatum, valid]);
    if (!result.ok) throw result.error;
    expect(result.data.aggregatedOrdersList.flat().flatMap((o) => o.orderTxInputs)).toEqual([valid]);
    expect(result.data.invalidOrderTxInputs).toEqual([wrongAddress, zero, tooMany, noDatum]);
    expect(Object.values(result.data.invalidOrderReasons)).toEqual([
      "Order TxInput must be from Orders Spend Script Address",
      "Order TxInput has 0 amount",
      "Order Tx Input has too many amount 4. maximum: 3",
      expect.stringMatching(/^Invalid Order Datum/),
    ]);
  });

  it("isOrderTxInputValid accepts a well-formed order", () => {
    expect(isOrderTxInputValid({ isMainnet: false, orderTxInput: order(1, BigInt(10)), settingsV1: settingsV1(), maxOrderAmountInOneTx: 3 }).ok).toBe(true);
  });
});

describe("request / refund guards", () => {
  const settings = { mint_governor: "", mint_version: BigInt(0), data: buildSettingsV1Data(settingsV1()) };

  it("pays one order output (OrderDatum with the destination's payment key) per order", async () => {
    const plan = await request({ isMainnet: false, orders: [{ destinationAddress: USER_1, amount: 2, cost: BigInt(20) }], settings, maxOrderAmountInOneTx: 3 });
    if (!plan.ok) throw plan.error;
    expect(plan.data.outputs).toHaveLength(1);
    expect(plan.data.outputs[0].address).toBe(ORDERS_ADDRESS);
    expect(plan.data.outputs[0].value.coins).toBe(BigInt(20));
    expect(Serialization.PlutusData.fromCore(plan.data.outputs[0].datum!).toCbor()).toBe(
      buildOrderDatumData({ owner_key_hash: "1".repeat(56), destination_address: USER_1, amount: 2 }).toCbor()
    );
  });

  it("refuses script destinations, non-positive or oversized amounts and too many orders", async () => {
    const script = scriptAddress("b".repeat(56), false);
    const one = (destinationAddress: string, amount: number) => ({ destinationAddress, amount, cost: BigInt(10) });
    const req = (orders: ReturnType<typeof one>[]) => request({ isMainnet: false, orders, settings, maxOrderAmountInOneTx: 3 });
    expect((await req([one(script, 1)])).ok).toBe(false);
    expect((await req([one(USER_1, 0)])).ok).toBe(false);
    expect((await req([one(USER_1, 4)])).ok).toBe(false);
    expect((await req(Array.from({ length: 21 }, () => one(USER_1, 1)))).ok).toBe(false);
    expect((await req(Array.from({ length: 20 }, () => one(USER_1, 1)))).ok).toBe(true);
  });

  it("refund refuses an order that is not at the orders validator", async () => {
    const settingsUtxo: Utxo = [{ ...order(1, BigInt(1))[0] }, { address: USER_2 as Cardano.PaymentAddress, value: { coins: BigInt(1) }, datum: constr(0, [fromCbor("4100"), fromCbor("00"), buildSettingsV1Data(settingsV1())]).toCore() }];
    const deployedScripts = { ordersSpendScriptDetails: { validatorHash: ORDERS_HASH }, ordersSpendScriptTxInput: settingsUtxo } as never;
    const elsewhere = order(1, BigInt(10), USER_1, scriptAddress("b".repeat(56), false) as Cardano.PaymentAddress);
    const result = await refund({ isMainnet: false, orderTxInput: elsewhere, refundingAddress: USER_1, deployedScripts, settingsAssetTxInput: settingsUtxo });
    expect(!result.ok && result.error.message).toMatch(/must be from Orders Spend Script Address/);
  });
});

describe("MPT proof JSON", () => {
  it("parses branch/fork/leaf steps and refuses malformed ones", () => {
    expect(parseMPTProofJSON([{ type: "branch", skip: 0, neighbors: "ab" }, { type: "fork", skip: 1, neighbor: { nibble: 2, prefix: "", root: "cd" } }, { type: "leaf", skip: 3, neighbor: { key: "k", value: "v" } }])).toEqual([
      { type: "branch", skip: 0, neighbors: "ab" },
      { type: "fork", skip: 1, neighbor: { nibble: 2, prefix: "", root: "cd" } },
      { type: "leaf", skip: 3, key: "k", value: "v" },
    ]);
    expect(() => parseMPTProofJSON({})).toThrow(/not an array/);
    expect(() => parseMPTProofJSON([{ type: "branch" }])).toThrow(/skip/);
    expect(() => parseMPTProofJSON([{ type: "nope", skip: 0 }])).toThrow(/type is invalid/);
  });
});

describe("slots", () => {
  // The builders convert validity times without a network round trip; scalus (the evaluator the tests
  // run) is the independent reference for each network's slot arithmetic.
  const { SlotConfig } = createRequire(import.meta.url)("scalus");
  it.each(["mainnet", "preview", "preprod"] as const)("%s: slotFromPosixMs agrees with scalus's SlotConfig", (network) => {
    const t = Date.UTC(2026, 8, 25, 12, 0, 0, 500);
    expect(slotFromPosixMs(t, network)).toBe(Math.floor(SlotConfig[network].timeToSlot(t)));
    expect(posixMsFromSlot(slotFromPosixMs(t, network), network)).toBe(t - 500);
  });
});

describe("completeTx", () => {
  const params = {
    minFeeA: BigInt(44), minFeeB: BigInt(155381), priceMemory: ratio("0.0577"), priceSteps: ratio("0.0000721"),
    minFeeRefScriptCostPerByte: ratio(15), coinsPerUtxoByte: BigInt(4310), stakeKeyDeposit: BigInt(2_000_000),
    maxTxSize: 16384, maxTxExUnits: { memory: 14_000_000, steps: 10_000_000_000 }, costModels: new Map(),
  };
  const walletUtxo = (i: number, coins: bigint): Utxo => [
    { txId: Cardano.TransactionId(`f${i}`.padStart(64, "0")), index: 0, address: USER_1 as Cardano.PaymentAddress },
    { address: USER_1 as Cardano.PaymentAddress, value: { coins } },
  ];

  it("pays a stake registration deposit and fee from the wallet, without evaluating anything", async () => {
    const stake = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, { type: Cardano.CredentialType.ScriptHash, hash: "5".repeat(56) as Cardano.Credential["hash"] }).toAddress().toBech32();
    const evaluate = vi.fn();
    const built = await completeTx({ plan: registerStakingAddresses([stake]), network: "preview", walletUtxos: [walletUtxo(1, BigInt(50_000_000))], changeAddress: USER_1, params: params as never, evaluate });
    expect(evaluate).not.toHaveBeenCalled();
    expect(built.outputs.at(-1)!.value.coins + built.fee + BigInt(2_000_000)).toBe(BigInt(50_000_000));
  });

  it("adds no wallet input when the plan pays for itself, and refuses a wallet that is short", async () => {
    const own = walletUtxo(2, BigInt(100_000_000));
    const plan: HalTxPlan = { inputs: [{ utxo: own }], outputs: [], plutusLanguages: [], referenceScriptBytes: 0 };
    const built = await completeTx({ plan, network: "preview", walletUtxos: [walletUtxo(3, BigInt(9_000_000))], changeAddress: USER_2, params: params as never, evaluate: vi.fn() });
    expect(built.outputs).toHaveLength(1);
    expect(built.outputs[0].value.coins + built.fee).toBe(BigInt(100_000_000));
    const short: HalTxPlan = { inputs: [], outputs: [{ address: USER_2 as Cardano.PaymentAddress, value: { coins: BigInt(50_000_000) } }], plutusLanguages: [], referenceScriptBytes: 0 };
    await expect(completeTx({ plan: short, network: "preview", walletUtxos: [walletUtxo(4, BigInt(9_000_000))], changeAddress: USER_1, params: params as never, evaluate: vi.fn() })).rejects.toThrow(/spendable lovelace/);
  });
});

describe("staking address status", () => {
  it("maps Blockfrost accounts to registered / deregistered / none", async () => {
    const getAccount = vi.fn(async (address: string) => (address === "a" ? { stake_address: "a", active: true } : address === "b" ? { stake_address: "b", active: false } : null));
    expect(await checkAccountRegistrationStatus({ getAccount }, "a", "b")).toEqual({ mintStakingAddress: "registered", refSpendStakingAddress: "deregistered" });
    expect(await checkAccountRegistrationStatus({ getAccount }, "c", "a")).toEqual({ mintStakingAddress: "none", refSpendStakingAddress: "registered" });
  });
});

describe("Handle API rate limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetRateLimits();
  });

  // Invariant: a 429's stated wait is honored process-wide — no call goes out before it expires.
  // Negative control: the call after the wait does go out.
  it("stops at a 429, and the next call waits out Retry-After before calling again", async () => {
    const { fetchApi } = await import("../src/helpers/api.js");
    const calls: number[] = [];
    const fetchMock = vi.fn(async () => {
      calls.push(Date.now());
      return calls.length === 1
        ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } })
        : new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchApi("handles/x")).rejects.toThrow(/Rate limited by handle-api: retry after 2s/);
    const start = Date.now();
    const response = await fetchApi("handles/x");
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1] - start).toBeGreaterThanOrEqual(1_900);
  });

  it("hands back a wait longer than it will hold the caller, without calling", async () => {
    const { fetchApi } = await import("../src/helpers/api.js");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "600" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchApi("handles/x")).rejects.toThrow(/retry after 600s/);
    await expect(fetchApi("handles/x")).rejects.toThrow(/retry after (599|600)s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("deployed scripts (Handle API /scripts + Blockfrost)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimits();
  });
  const script = (hex: string): Cardano.Script => ({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: hex as never });
  // two tiny distinct "scripts": the hash is all that matters here
  const A = script("4e4d01000033222220051200120011");
  const B = script("4e4d01000033222220051200120012");
  const hashA = Serialization.Script.fromCore(A).hash();
  const refUtxo = (txByte: string, s: Cardano.Script): Utxo => [
    { txId: Cardano.TransactionId(txByte.repeat(64)), index: 0, address: USER_1 as Cardano.PaymentAddress },
    { address: USER_1 as Cardano.PaymentAddress, value: { coins: BigInt(20_000_000) }, scriptReference: s },
  ];

  // Failure caught: 1.x read the retired single-object /scripts shape, so every script "had no Ref
  // script UTxO". The prefix match of ?type= must not let `halmnt` pick `halmntprx`.
  it("picks the exact type from the Record response and follows a moved reference script", async () => {
    const { ScriptType } = await import("@koralabs/kora-labs-common");
    const { fetchAllDeployedScripts } = await import("../src/txs/deploy.js");
    const entries: Record<string, object> = {};
    for (const type of Object.values(ScriptType).filter((t) => String(t).startsWith("hal"))) {
      entries[`addr_${type}`] = { type, latest: true, validatorHash: hashA, refScriptUtxo: `${"1".repeat(64)}#0` };
    }
    entries["addr_decoy"] = { type: `${ScriptType.HAL_MINT}prx_old`, latest: true, validatorHash: "00", refScriptUtxo: "x#0" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(entries), { status: 200 })));
    const spent = vi.fn(async () => { throw new Error(`${"1".repeat(64)}#0 already spent by ${"9".repeat(64)}`); });
    const result = await fetchAllDeployedScripts({ getUtxo: spent, getAddressUtxos: async () => [refUtxo("3", B), refUtxo("2", A)] } as never);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.mintScriptDetails.type).toBe(ScriptType.HAL_MINT);
    expect(result.data.mintScriptDetails.refScriptUtxo).toBe(`${"2".repeat(64)}#0`);
    // negative control: a reference UTxO carrying another script is refused
    const wrong = await fetchAllDeployedScripts({ getUtxo: async () => refUtxo("4", B), getAddressUtxos: async () => [] } as never);
    expect(!wrong.ok && wrong.error).toMatch(/does not carry script/);
  });
});
