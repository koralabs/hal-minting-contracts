import { makeAddress, makeInlineTxOutputDatum, makePubKeyHash } from "@helios-lang/ledger";
import { makeConstrData } from "@helios-lang/uplc";
import { describe, expect, test } from "vitest";

import {
  buildMintBurnNFTsRedeemer,
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintingDataUpdateMPTRedeemer,
  buildMintMintNFTsRedeemer,
  buildMintMintRoyaltyNFTRedeemer,
  buildMPTProofData,
  buildMPTProofStepData,
  buildNeighborData,
  buildOrderDatumData,
  buildOrdersSpendCancelOrderRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  buildOrdersSpendRefundOrderRedeemer,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildRoyaltyDatumData,
  buildRoyaltyRecipientData,
  buildRoyaltySpendMigrateRedeemer,
  buildRoyaltySpendUpdateRedeemer,
  buildSettingsData,
  buildSettingsV1Data,
  convertOnChainPercentageToPercentage,
  convertPercentageToOnChainPercentage,
  decodeMintingDataDatum,
  decodeOrderDatumData,
  decodeRefSpendSettingsData,
  decodeRefSpendSettingsDatum,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  decodeWhitelistedValueFromCBOR,
  makeWhitelistedValueData,
} from "../src/contracts/index.js";

const hash = (char: string) => char.repeat(56);

describe("contract data coverage", () => {
  test("mint, royalty, and order redeemer builders expose their constructor tags", () => {
    expect((buildMintMintNFTsRedeemer() as { tag: number }).tag).toBe(0);
    expect((buildMintBurnNFTsRedeemer() as { tag: number }).tag).toBe(1);
    expect((buildMintMintRoyaltyNFTRedeemer() as { tag: number }).tag).toBe(2);
    expect((buildRoyaltySpendUpdateRedeemer() as { tag: number }).tag).toBe(0);
    expect((buildRoyaltySpendMigrateRedeemer() as { tag: number }).tag).toBe(1);
    expect((buildOrdersSpendExecuteOrdersRedeemer() as { tag: number }).tag).toBe(0);
    expect((buildOrdersSpendCancelOrderRedeemer() as { tag: number }).tag).toBe(1);
    expect((buildOrdersSpendRefundOrderRedeemer() as { tag: number }).tag).toBe(2);
  });

  test("royalty datum builders cover recipient fee bounds and conversions", () => {
    const boundedRecipient = {
      address: makeAddress(false, makePubKeyHash(hash("1"))),
      fee: 1.6,
      min_fee: 2n,
      max_fee: 3n,
    };
    const unboundedRecipient = {
      address: makeAddress(false, makePubKeyHash(hash("2"))),
      fee: 100,
    };

    expect(convertPercentageToOnChainPercentage(1.6)).toBe(625n);
    expect(convertOnChainPercentageToPercentage(625n)).toBe(1.6);
    expect(() => convertPercentageToOnChainPercentage(0.09)).toThrow(
      "Royalty fee must be between 0.1 and 100 percent"
    );
    expect(() => convertPercentageToOnChainPercentage(101)).toThrow(
      "Royalty fee must be between 0.1 and 100 percent"
    );

    expect((buildRoyaltyRecipientData(boundedRecipient) as { tag: number }).tag).toBe(0);
    expect((buildRoyaltyRecipientData(unboundedRecipient) as { tag: number }).tag).toBe(0);
    expect(
      (
        buildRoyaltyDatumData({
          recipients: [boundedRecipient, unboundedRecipient],
          version: 2,
          extra: makeConstrData(0, []),
        }) as { tag: number }
      ).tag
    ).toBe(0);
  });

  test("settings v1 builders round trip full HAL and ref-spend payloads", () => {
    const paymentAddress = makeAddress(false, makePubKeyHash(hash("3")));
    const settingsV1 = {
      policy_id: hash("4"),
      allowed_minter: hash("5"),
      hal_nft_price: 123n,
      minting_data_script_hash: hash("6"),
      orders_spend_script_hash: hash("7"),
      ref_spend_proxy_script_hash: hash("8"),
      ref_spend_governor: hash("9"),
      ref_spend_admin: hash("a"),
      royalty_spend_script_hash: hash("b"),
      minting_start_time: 1234,
      payment_address: paymentAddress,
    };

    const decoded = decodeSettingsV1Data(buildSettingsV1Data(settingsV1), false);

    expect(decoded).toMatchObject({
      policy_id: settingsV1.policy_id,
      allowed_minter: settingsV1.allowed_minter,
      hal_nft_price: settingsV1.hal_nft_price,
      minting_data_script_hash: settingsV1.minting_data_script_hash,
      orders_spend_script_hash: settingsV1.orders_spend_script_hash,
      ref_spend_proxy_script_hash: settingsV1.ref_spend_proxy_script_hash,
      ref_spend_governor: settingsV1.ref_spend_governor,
      ref_spend_admin: settingsV1.ref_spend_admin,
      royalty_spend_script_hash: settingsV1.royalty_spend_script_hash,
      minting_start_time: settingsV1.minting_start_time,
    });
    expect(decoded.payment_address.toBech32()).toBe(paymentAddress.toBech32());

    const refSpendSettingsV1 = {
      policy_id: hash("c"),
      ref_spend_admin: hash("d"),
    };
    expect(
      decodeRefSpendSettingsV1Data(
        buildRefSpendSettingsV1Data(refSpendSettingsV1)
      )
    ).toEqual(refSpendSettingsV1);
  });

  test("minting data builders round trip roots and optional proof redeemers", () => {
    const mintingData = {
      mpt_root_hash: "aa".repeat(32),
      whitelist_mpt_root_hash: "bb".repeat(32),
    };
    const mintingDatum = makeInlineTxOutputDatum(buildMintingData(mintingData));

    expect(decodeMintingDataDatum(mintingDatum)).toEqual(mintingData);
    expect(() => decodeMintingDataDatum(undefined)).toThrow(
      "Minting Data Datum must be inline datum"
    );

    const mintRedeemer = buildMintingDataMintRedeemer([
      [
        [["68616c", [{ type: "leaf", skip: 0, key: "dd", value: "ee" }]]],
        undefined,
      ],
    ] as never);

    expect((mintRedeemer as { tag: number }).tag).toBe(0);
    expect((buildMintingDataUpdateMPTRedeemer() as { tag: number }).tag).toBe(1);
  });

  test("MPT proof data builders preserve branch, fork, leaf, and neighbor tags", () => {
    const proof = [
      { type: "branch", skip: 1, neighbors: "aa" },
      { type: "fork", skip: 2, neighbor: { nibble: 3, prefix: "bb", root: "cc" } },
      { type: "leaf", skip: 4, key: "dd", value: "ee" },
    ] as const;

    expect((buildMPTProofData([...proof] as never) as { kind: string }).kind).toBe("list");
    expect((buildMPTProofStepData(proof[0] as never) as { tag: number }).tag).toBe(0);
    expect((buildMPTProofStepData(proof[1] as never) as { tag: number }).tag).toBe(1);
    expect((buildMPTProofStepData(proof[2] as never) as { tag: number }).tag).toBe(2);
    expect(
      (buildNeighborData({ nibble: 3, prefix: "bb", root: "cc" }) as { tag: number }).tag
    ).toBe(0);
  });

  test("whitelist CBOR decoding covers multi-item values and valid non-list failures", () => {
    const whitelistedValue = [
      { time_gap: 0, amount: 1, price: 1n },
      { time_gap: 30, amount: 2, price: 5_000_000n },
    ];

    const decoded = decodeWhitelistedValueFromCBOR(
      Buffer.from(makeWhitelistedValueData(whitelistedValue).toCbor())
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data).toEqual(whitelistedValue);

    const notList = decodeWhitelistedValueFromCBOR(
      Buffer.from(makeConstrData(0, []).toCbor())
    );
    expect(notList.ok).toBe(false);
    if (!notList.ok) {
      expect(notList.error.message).toContain("whitelisted_value must be List Data");
    }
  });

  test("datum decoders reject missing inline datum guardrails", () => {
    expect(() => decodeOrderDatumData(undefined, false)).toThrow(
      "OrderDatum must be inline datum"
    );
    expect(() => decodeSettingsDatum(undefined)).toThrow(
      "Settings must be inline datum"
    );
    expect(() => decodeRefSpendSettingsDatum(undefined)).toThrow(
      "RefSpendSettings must be inline datum"
    );
  });
});
