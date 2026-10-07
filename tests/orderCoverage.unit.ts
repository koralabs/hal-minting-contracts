// Focused coverage for order scheduling, whitelist consumption, and MPT proof state transitions.
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { describe, expect, it, vi } from "vitest";

import {
  buildOrderDatumData,
  buildProofs,
  Cardano,
  getWhitelistedKey,
  makeWhitelistedValueData,
  MPT_MINTED_VALUE,
  orderToConsecutiveSum7,
  prepareOrders,
  scriptAddress,
  SettingsV1,
  Utxo,
} from "./v2.js";

const ORDERS_HASH = "a".repeat(56);
const ORDERS_ADDRESS = scriptAddress(ORDERS_HASH, false) as Cardano.PaymentAddress;
const destination = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { type: Cardano.CredentialType.KeyHash, hash: "1".repeat(56) as Cardano.Credential["hash"] },
  { type: Cardano.CredentialType.KeyHash, hash: "2".repeat(56) as Cardano.Credential["hash"] }
)
  .toAddress()
  .toBech32();

const settings: SettingsV1 = {
  policy_id: "b".repeat(56),
  allowed_minter: "c".repeat(56),
  hal_nft_price: BigInt(10),
  minting_data_script_hash: "d".repeat(56),
  orders_spend_script_hash: ORDERS_HASH,
  ref_spend_proxy_script_hash: "e".repeat(56),
  ref_spend_governor: "f".repeat(56),
  ref_spend_admin: "0".repeat(56),
  royalty_spend_script_hash: "9".repeat(56),
  minting_start_time: 2_000,
  payment_address: destination,
};

let orderNumber = 0;
const order = (amount: number, lovelace: bigint): Utxo => {
  orderNumber++;
  return [
    {
      txId: Cardano.TransactionId(orderNumber.toString(16).padStart(64, "0")),
      index: 0,
      address: ORDERS_ADDRESS,
    },
    {
      address: ORDERS_ADDRESS,
      value: { coins: lovelace },
      datum: buildOrderDatumData({
        owner_key_hash: "1".repeat(56),
        destination_address: destination,
        amount,
      }).toCore(),
    },
  ];
};

const whitelist = (amount: number, price = BigInt(5), timeGap = 10_000) => ({
  get: vi.fn(async () =>
    Buffer.from(makeWhitelistedValueData([{ time_gap: timeGap, amount, price }]).toCbor(), "hex")
  ),
});

const prepare = (orderTxInputs: Utxo[], whitelistDB: object, overrides: Partial<Parameters<typeof prepareOrders>[0]> = {}) =>
  prepareOrders({
    isMainnet: false,
    orderTxInputs,
    settingsV1: settings,
    whitelistDB: whitelistDB as never,
    mintingTime: 3_000,
    maxOrderAmountInOneTx: 7,
    maxTxsPerLambda: 2,
    remainingHals: 20,
    ...overrides,
  });

describe("focused order coverage", () => {
  // Invariant: a seven-HAL batch uses the fewest later orders and leaves unrelated orders stable.
  // Failure caught: a greedy search consumes a longer combination or reorders unmatched orders.
  it("prefers the shortest sum-to-seven combination and preserves unmatched order identity", () => {
    const orders = [1, 2, 2, 2, 6, 9].map((amount, id) => ({ id, datum: { amount } }));
    const arranged = orderToConsecutiveSum7(orders);
    expect(arranged.map(({ id }) => id)).toEqual([0, 4, 1, 2, 3, 5]);
    expect(arranged).toHaveLength(orders.length);
    // Negative control: without the six-HAL candidate, the three two-HAL orders complete seven.
    expect(orderToConsecutiveSum7(orders.filter(({ id }) => id !== 4)).map(({ id }) => id)).toEqual([
      0,
      1,
      2,
      3,
      5,
    ]);
  });

  // Invariant: whitelist eligibility cannot make the public-price remainder mint before public sale.
  // Failure caught: partially covered orders mint early by paying the later public price.
  it("refunds a partially whitelisted order before the public mint opens", async () => {
    const input = order(2, BigInt(15));
    const result = await prepare([input], whitelist(1), { mintingTime: 1_000 });
    if (!result.ok) throw result.error;
    expect(result.data.aggregatedOrdersList).toEqual([]);
    expect(result.data.invalidOrderTxInputs).toEqual([input]);
    expect(Object.values(result.data.invalidOrderReasons)).toEqual([
      "unprocessable: cannot be minted ALL as whitelisted; wait till minting_start_time",
    ]);
  });

  // Invariant: multiple orders for one address share and deplete one whitelist allowance.
  // Failure caught: the same discounted whitelist unit is reused for a later order.
  it("depletes an address whitelist across orders and reads its trie entry once", async () => {
    const db = whitelist(1);
    const discounted = order(1, BigInt(5));
    const reusedDiscount = order(1, BigInt(5));
    const result = await prepare([discounted, reusedDiscount], db);
    if (!result.ok) throw result.error;
    expect(db.get).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledWith(getWhitelistedKey(destination));
    expect(result.data.aggregatedOrdersList.flat().flatMap(({ orderTxInputs }) => orderTxInputs)).toEqual([
      discounted,
    ]);
    expect(result.data.invalidOrderTxInputs).toEqual([reusedDiscount]);
    expect(Object.values(result.data.invalidOrderReasons)[0]).toMatch(/need 10 even as whitelisted but has only 5/);
  });
});

describe("buildProofs", () => {
  // Invariant: proof generation follows requested asset order and atomically marks each asset minted.
  // Failure caught: proofs are reordered or the trie remains reusable for duplicate minting.
  it("returns ordered proofs and marks every proved asset as minted", async () => {
    const db = await Trie.fromList([
      { key: "hal-1", value: "" },
      { key: "hal-2", value: "" },
    ]);
    const result = await buildProofs({
      orderedAssets: [
        { utf8Name: "hal-2", hexName: "68616c2d32", destinationAddress: destination, price: BigInt(10) },
        { utf8Name: "hal-1", hexName: "68616c2d31", destinationAddress: destination, price: BigInt(10) },
      ],
      db,
    });
    if (!result.ok) throw result.error;
    expect(result.data.map(({ asset_name }) => asset_name)).toEqual(["68616c2d32", "68616c2d31"]);
    expect(result.data.every(({ mpt_proof }) => Array.isArray(mpt_proof))).toBe(true);
    expect((await db.get("hal-1"))?.toString()).toBe(MPT_MINTED_VALUE);
    expect((await db.get("hal-2"))?.toString()).toBe(MPT_MINTED_VALUE);
  });

  // Invariant: an unknown asset never produces a mint proof or mutates existing entries.
  // Failure caught: absent names are accepted, enabling an asset outside the predefined trie.
  it("rejects an unknown asset without changing existing trie values", async () => {
    const db = await Trie.fromList([{ key: "hal-1", value: "" }]);
    const result = await buildProofs({
      orderedAssets: [
        { utf8Name: "hal-missing", hexName: "00", destinationAddress: destination, price: BigInt(10) },
      ],
      db,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("negative control unexpectedly built a proof");
    expect(result.error.message).toMatch(/Asset name is not pre-defined: hal-missing/);
    expect((await db.get("hal-1"))?.toString()).toBe("");
  });
});
