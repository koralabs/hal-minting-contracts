import { makeAddress, makePubKeyHash } from "@helios-lang/ledger";
import { makeConstrData } from "@helios-lang/uplc";
import { describe, expect, test } from "vitest";

import {
  buildMintBurnNFTsRedeemer,
  buildMintMintNFTsRedeemer,
  buildMintMintRoyaltyNFTRedeemer,
  buildRefSpendSettingsV1Data,
  buildRoyaltyDatumData,
  buildRoyaltyRecipientData,
  buildRoyaltySpendMigrateRedeemer,
  buildRoyaltySpendUpdateRedeemer,
  buildSettingsV1Data,
  convertOnChainPercentageToPercentage,
  convertPercentageToOnChainPercentage,
  decodeRefSpendSettingsV1Data,
  decodeSettingsV1Data,
} from "../src/contracts/index.js";

const hash = (char: string) => char.repeat(56);

describe("contract data coverage", () => {
  test("mint and royalty redeemer builders expose their constructor tags", () => {
    expect((buildMintMintNFTsRedeemer() as { tag: number }).tag).toBe(0);
    expect((buildMintBurnNFTsRedeemer() as { tag: number }).tag).toBe(1);
    expect((buildMintMintRoyaltyNFTRedeemer() as { tag: number }).tag).toBe(2);
    expect((buildRoyaltySpendUpdateRedeemer() as { tag: number }).tag).toBe(0);
    expect((buildRoyaltySpendMigrateRedeemer() as { tag: number }).tag).toBe(1);
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
});
