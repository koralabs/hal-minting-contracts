// Failure paths of order fetching/cancelling, whitelist lookups and deployed-script discovery.
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWhitelistedKey } from "./v2.js";
import {
  buildOrderDatumData,
  Cardano,
  cancel,
  constr,
  fetchOrderTxInputs,
  request,
  scriptAddress,
  Utxo,
} from "./v2.js";
import { getWhitelistedValue } from "../src/txs/whitelist.js";
import { fetchDeployedScript } from "../src/utils/contract.js";

const ORDERS_HASH = "a".repeat(56);
const ORDERS_ADDRESS = scriptAddress(ORDERS_HASH, false) as Cardano.PaymentAddress;
const key = (h: string) =>
  Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { type: Cardano.CredentialType.KeyHash, hash: h.repeat(56) as Cardano.Credential["hash"] },
    { type: Cardano.CredentialType.KeyHash, hash: "e".repeat(56) as Cardano.Credential["hash"] }
  )
    .toAddress()
    .toBech32();
const USER = key("1");

const orderUtxo = (address = ORDERS_ADDRESS, datum?: Utxo[1]["datum"]): Utxo => [
  { txId: Cardano.TransactionId("1".padStart(64, "0")), index: 0, address },
  {
    address,
    value: { coins: BigInt(10) },
    datum: datum ?? buildOrderDatumData({ owner_key_hash: "1".repeat(56), destination_address: USER, amount: 1 }).toCore(),
  },
];
const deployedScripts = { ordersSpendScriptDetails: { validatorHash: ORDERS_HASH }, ordersSpendScriptTxInput: orderUtxo() } as never;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("order builders: failure paths", () => {
  it("request reports undecodable settings instead of building outputs", async () => {
    const bad = { mint_governor: "", mint_version: BigInt(0), data: constr(0) };
    const result = await request({ isMainnet: false, orders: [{ destinationAddress: USER, amount: 1, cost: BigInt(10) }], settings: bad, maxOrderAmountInOneTx: 3 });
    expect(!result.ok && result.error.message).toMatch(/^Failed to decode settings v1/);
  });

  it("cancel refuses script addresses, foreign orders and orders without a datum", async () => {
    const run = (address: string, orderTxInput: Utxo) => cancel({ isMainnet: false, address, orderTxInput, deployedScripts });
    const script = scriptAddress("b".repeat(56), false);
    expect((await run(script, orderUtxo())).ok).toBe(false);
    const foreign = await run(USER, orderUtxo(scriptAddress("b".repeat(56), false) as Cardano.PaymentAddress));
    expect(!foreign.ok && foreign.error.message).toMatch(/must be from Orders Spend Script Address/);
    const noDatum = await run(USER, [orderUtxo()[0], { address: ORDERS_ADDRESS, value: { coins: BigInt(10) } }]);
    expect(!noDatum.ok && noDatum.error.message).toMatch(/^Order Tx Input datum is invalid/);
    const good = await run(USER, orderUtxo());
    expect(good.ok && good.data.requiredSigners).toEqual(["1".repeat(56)]);
  });

  it("fetchOrderTxInputs returns the validator's UTxOs and reports a failed lookup", async () => {
    const utxos = [orderUtxo()];
    const details = { validatorHash: ORDERS_HASH } as never;
    const ok = await fetchOrderTxInputs({ isMainnet: false, blockfrost: { getAddressUtxos: vi.fn(async () => utxos) } as never, ordersSpendScriptDetails: details });
    expect(ok.ok && ok.data).toEqual(utxos);
    const getAddressUtxos = vi.fn(async () => { throw new Error("boom"); });
    const failed = await fetchOrderTxInputs({ isMainnet: false, blockfrost: { getAddressUtxos } as never, ordersSpendScriptDetails: details });
    expect(!failed.ok && failed.error.message).toMatch(/^Failed to fetch order UTxOs/);
    expect(getAddressUtxos).toHaveBeenCalledWith(ORDERS_ADDRESS);
  });
});

describe("getWhitelistedValue", () => {
  it("returns null for a missing key, undecodable data and a failing database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lookup = (get: () => Promise<unknown>) => getWhitelistedValue({ get } as never, USER);
    expect(await lookup(async () => undefined)).toBeNull();
    expect(await lookup(async () => Buffer.from("ff", "hex"))).toBeNull();
    expect(await lookup(async () => { throw new Error("db down"); })).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("looks up by the address's whitelist key", async () => {
    const get = vi.fn(async () => undefined);
    await getWhitelistedValue({ get } as never, USER);
    expect(get).toHaveBeenCalledWith(getWhitelistedKey(USER));
  });
});

describe("fetchDeployedScript", () => {
  const respond = (body: unknown, init: ResponseInit = { status: 200 }) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init)));

  it("picks the exact-type latest entry and defaults its ref address to the map key", async () => {
    respond({
      addr_prefix: { type: "halmntprx", latest: true },
      addr_old: { type: "halmnt", latest: false },
      addr_new: { type: "halmnt", latest: true },
    });
    expect(await fetchDeployedScript("halmnt" as never)).toMatchObject({ type: "halmnt", refScriptAddress: "addr_new" });
  });

  it("refuses an error response, a non-object body and a list with no exact match", async () => {
    respond("nope", { status: 500, statusText: "Server Error" });
    await expect(fetchDeployedScript("halmnt" as never)).rejects.toThrow(/Failed to fetch halmnt script details: nope/);
    respond("null");
    await expect(fetchDeployedScript("halmnt" as never)).rejects.toThrow(/api returned object, expected Record/);
    respond({ a: { type: "halmntprx", latest: true } });
    await expect(fetchDeployedScript("halmnt" as never)).rejects.toThrow(/halmnt script details not deployed/);
  });
});
