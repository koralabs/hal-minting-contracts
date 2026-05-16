import {
  makeAddress,
  makeInlineTxOutputDatum,
  makePubKeyHash,
  makeValidatorHash,
  makeValue,
} from "@helios-lang/ledger";
import { makeByteArrayData, makeConstrData } from "@helios-lang/uplc";
import { describe, expect, test, vi } from "vitest";

const VOID_DATA = makeConstrData(0, []);

const makeOrderInput = (
  amount: number,
  lovelace: bigint,
  destinationAddress = makeAddress(false, makePubKeyHash("1".repeat(56)))
) => {
  const orderDatum = {
    owner_key_hash: destinationAddress.spendingCredential.toHex(),
    destination_address: destinationAddress,
    amount,
  };

  return {
    id: { toString: () => `tx-${amount}-${lovelace}` },
    address: makeAddress(false, makeValidatorHash("a".repeat(56))),
    datum: Object.assign(makeInlineTxOutputDatum(VOID_DATA), {
      __orderDatum: orderDatum,
    }),
    value: makeValue(lovelace),
  };
};

describe("prepare orders coverage", () => {
  test("orderToConsecutiveSum7 prefers shortest consecutive partners while preserving order", async () => {
    const { orderToConsecutiveSum7 } = await import("../src/txs/prepareOrders.js");
    const orders = [1, 2, 4, 3, 6, 1, 8].map((amount, index) => ({
      txInput: { id: { toString: () => `tx-${index}` } },
      datum: { amount },
    })) as never;

    const sorted = orderToConsecutiveSum7(orders).map(({ datum }) => datum.amount);

    expect(sorted).toEqual([1, 6, 2, 4, 1, 3, 8]);
  });

  test("aggregateOrderTxInputs separates valid, unpicked, and invalid orders", async () => {
    vi.resetModules();
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeOrderDatumData: vi.fn((datum) => (datum as { __orderDatum?: unknown }).__orderDatum ?? {
          owner_key_hash: "1".repeat(56),
          destination_address: makeAddress(false, makePubKeyHash("1".repeat(56))),
          amount: 1,
        }),
      };
    });

    const { aggregateOrderTxInputs } = await import("../src/txs/prepareOrders.js");
    const destinationAddress = makeAddress(false, makePubKeyHash("1".repeat(56)));
    const orderInputs = [
      makeOrderInput(2, 20n, destinationAddress),
      makeOrderInput(1, 10n, destinationAddress),
      makeOrderInput(3, 30n, destinationAddress),
    ];

    const result = await aggregateOrderTxInputs({
      isMainnet: false,
      orderTxInputs: orderInputs as never,
      settingsV1: {
        hal_nft_price: 10n,
        minting_start_time: 2_000,
        orders_spend_script_hash: "a".repeat(56),
      } as never,
      whitelistDB: { get: vi.fn(async () => null) } as never,
      mintingTime: 3_000,
      maxOrderAmountInOneTx: 3,
      maxTxsPerLambda: 1,
      remainingHals: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.aggregatedOrdersList).toHaveLength(1);
    expect(result.data.aggregatedOrdersList[0][0].amount).toBe(3);
    expect(result.data.unpickedOrderTxInputs).toHaveLength(0);
    expect(result.data.invalidOrderTxInputs).toHaveLength(1);
    expect(result.data.invalidOrderTxInputs[0].id.toString()).toBe("tx-3-30");
  });

  test("prepareOrders includes initial invalid orders and aggregation-time invalid orders", async () => {
    vi.resetModules();
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeOrderDatumData: vi.fn((datum) => (datum as { __orderDatum?: unknown }).__orderDatum ?? {
          owner_key_hash: "1".repeat(56),
          destination_address: makeAddress(false, makePubKeyHash("1".repeat(56))),
          amount: 1,
        }),
      };
    });

    const { prepareOrders } = await import("../src/txs/prepareOrders.js");
    const destinationAddress = makeAddress(false, makePubKeyHash("1".repeat(56)));
    const invalidAddressOrder = {
      ...makeOrderInput(1, 10n, destinationAddress),
      address: makeAddress(false, makeValidatorHash("b".repeat(56))),
    };
    const zeroAmountOrder = makeOrderInput(0, 10n, destinationAddress);
    const validOrder = makeOrderInput(1, 10n, destinationAddress);

    const result = await prepareOrders({
      isMainnet: false,
      orderTxInputs: [invalidAddressOrder, zeroAmountOrder, validOrder] as never,
      settingsV1: {
        hal_nft_price: 10n,
        minting_start_time: 2_000,
        orders_spend_script_hash: "a".repeat(56),
      } as never,
      whitelistDB: { get: vi.fn(async () => null) } as never,
      mintingTime: 3_000,
      maxOrderAmountInOneTx: 3,
      maxTxsPerLambda: 2,
      remainingHals: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.aggregatedOrdersList).toHaveLength(1);
    expect(result.data.invalidOrderTxInputs.map((input) => input.id.toString())).toEqual([
      invalidAddressOrder.id.toString(),
      zeroAmountOrder.id.toString(),
    ]);
  });

  test("prepareOrders returns aggregation failures with context", async () => {
    vi.resetModules();
    let decodeCalls = 0;
    vi.doMock("../src/contracts/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/contracts/index.js")>();
      return {
        ...original,
        decodeOrderDatumData: vi.fn((datum) => {
          decodeCalls += 1;
          if (decodeCalls > 1) {
            throw new Error("bad datum");
          }
          return (datum as { __orderDatum?: unknown }).__orderDatum;
        }),
      };
    });

    const { prepareOrders } = await import("../src/txs/prepareOrders.js");
    const result = await prepareOrders({
      isMainnet: false,
      orderTxInputs: [makeOrderInput(1, 10n)] as never,
      settingsV1: {
        hal_nft_price: 10n,
        minting_start_time: 2_000,
        orders_spend_script_hash: "a".repeat(56),
      } as never,
      whitelistDB: { get: vi.fn(async () => null) } as never,
      mintingTime: 1_000,
      maxOrderAmountInOneTx: 3,
      maxTxsPerLambda: 2,
      remainingHals: 3,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Failed to aggregate orders");
    expect(result.error.message).toContain("bad datum");
  });

  test("contract data builders encode MPT and minting proof redeemers", async () => {
    const {
      buildMPTProofData,
      buildMPTProofStepData,
      buildMintingDataMintRedeemer,
      buildMintingDataUpdateMPTRedeemer,
      decodeWhitelistedValueFromCBOR,
      makeWhitelistedValueData,
    } = await import("../src/contracts/index.js");

    const proof = [
      { type: "branch", skip: 1, neighbors: "aa" },
      { type: "fork", skip: 2, neighbor: { nibble: 3, prefix: "bb", root: "cc" } },
      { type: "leaf", skip: 4, key: "dd", value: "ee" },
    ] as const;
    const whitelistedValue = [{ time_gap: 5, amount: 2, price: 3n }];

    expect(buildMPTProofData([...proof] as never).kind).toBe("list");
    expect(buildMPTProofStepData(proof[0] as never).kind).toBe("constr");
    expect(buildMPTProofStepData(proof[1] as never).kind).toBe("constr");
    expect(buildMPTProofStepData(proof[2] as never).kind).toBe("constr");
    expect(buildMintingDataMintRedeemer([[[["68616c", [...proof]], [whitelistedValue, [...proof]]]]] as never).kind).toBe("constr");
    expect(buildMintingDataUpdateMPTRedeemer().kind).toBe("constr");

    const encodedWhitelist = makeWhitelistedValueData(whitelistedValue).toCbor();
    const decoded = decodeWhitelistedValueFromCBOR(Buffer.from(encodedWhitelist));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data).toEqual(whitelistedValue);
    expect(decodeWhitelistedValueFromCBOR(Buffer.from("ff", "hex")).ok).toBe(false);
  });

  test("order datum and settings datum builders round trip standard shapes", async () => {
    vi.resetModules();
    vi.doUnmock("../src/contracts/index.js");
    const {
      buildOrderDatumData,
      buildRefSpendSettingsData,
      buildRoyaltyFlagCIP68ExtraData,
      buildSettingsData,
      decodeOrderDatumData,
      decodeRefSpendSettingsDatum,
      decodeSettingsDatum,
    } = await import("../src/contracts/index.js");
    const destinationAddress = makeAddress(false, makePubKeyHash("1".repeat(56)));

    const orderDatum = {
      owner_key_hash: "2".repeat(56),
      destination_address: destinationAddress,
      amount: 3,
    };
    expect(
      decodeOrderDatumData(makeInlineTxOutputDatum(buildOrderDatumData(orderDatum)), false)
    ).toMatchObject({ owner_key_hash: orderDatum.owner_key_hash, amount: 3 });

    const settingsDatum = makeInlineTxOutputDatum(
      buildSettingsData({
        mint_governor: "3".repeat(56),
        mint_version: 1n,
        data: makeByteArrayData("aa"),
      })
    );
    expect(decodeSettingsDatum(settingsDatum)).toMatchObject({
      mint_governor: "3".repeat(56),
      mint_version: 1n,
    });

    const refSpendDatum = makeInlineTxOutputDatum(
      buildRefSpendSettingsData({
        ref_spend_governor: "4".repeat(56),
        data: makeByteArrayData("bb"),
      })
    );
    expect(decodeRefSpendSettingsDatum(refSpendDatum)).toMatchObject({
      ref_spend_governor: "4".repeat(56),
    });
    expect(buildRoyaltyFlagCIP68ExtraData().kind).toBe("constr");
  });
});
