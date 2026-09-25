// Byte-for-byte parity with hal-minting-contracts 1.2.33 (Helios). fixtures/heliosV1.json holds what v1
// produced for fixed inputs (see fixtures/generateHeliosV1.ts); v2 (cardano-sdk + scalus) must produce
// the same bytes — datums and redeemers the validators read, whitelist MPT keys (address CBOR), and the
// parameter-applied validator scripts whose hashes are the deployed policy id / script addresses.
// Negative controls: each group also checks that a one-field change changes the bytes, so a
// comparison that could never fail (e.g. both sides empty) would be caught.
import { readFileSync } from "node:fs";

import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { describe, expect, it } from "vitest";

import * as MAINNET from "../scripts/configs/mainnet.config.js";
import * as PREPROD from "../scripts/configs/preprod.config.js";
import * as PREVIEW from "../scripts/configs/preview.config.js";
import {
  buildContracts,
  buildMintBurnNFTsRedeemer,
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintingDataUpdateMPTRedeemer,
  buildMintMintNFTsRedeemer,
  buildMintMintRoyaltyNFTRedeemer,
  buildOrderDatumData,
  buildOrdersSpendCancelOrderRedeemer,
  buildOrdersSpendExecuteOrdersRedeemer,
  buildOrdersSpendRefundOrderRedeemer,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildRoyaltyDatumData,
  buildRoyaltyFlagCIP68ExtraData,
  buildRoyaltySpendMigrateRedeemer,
  buildRoyaltySpendUpdateRedeemer,
  buildSettingsData,
  buildSettingsV1Data,
  CONTRACT_NAME_VALUES,
  decodeMintingDataDatum,
  decodeOrderDatumData,
  decodeRefSpendSettingsDatum,
  decodeRefSpendSettingsV1Data,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  decodeWhitelistedValueFromCBOR,
  deploy,
  fromCbor,
  getWhitelistedKey,
  makeVoidData,
  makeWhitelistedValueData,
  parseMPTProofJSON,
  WhitelistedValue,
} from "./v2.js";

const v1 = JSON.parse(readFileSync(new URL("./fixtures/heliosV1.json", import.meta.url), "utf8"));
const configs = { preview: PREVIEW, preprod: PREPROD, mainnet: MAINNET } as const;
const addresses: Record<string, string> = v1.addresses;
const isMainnetAddress = (a: string) => a.startsWith("addr1");

describe("Plutus Address data (whitelist MPT keys)", () => {
  it.each(Object.entries(addresses))("%s encodes as Helios did", (name, address) => {
    expect(getWhitelistedKey(address).toString("hex")).toBe(v1.addressData[name]);
  });
  it("different addresses give different keys (negative control)", () => {
    expect(getWhitelistedKey(addresses.previewBase).toString("hex")).not.toBe(v1.addressData.previewEnterprise);
  });
});

describe("OrderDatum", () => {
  it.each(v1.orderDatums as { address: string; owner_key_hash: string; amount: number; cbor: string }[])(
    "$address round-trips byte-for-byte",
    ({ address, owner_key_hash, amount, cbor }) => {
      const datum = { owner_key_hash, destination_address: addresses[address], amount };
      expect(buildOrderDatumData(datum).toCbor()).toBe(cbor);
      expect(decodeOrderDatumData(fromCbor(cbor), isMainnetAddress(addresses[address]))).toEqual(datum);
      expect(buildOrderDatumData({ ...datum, amount: amount + 1 }).toCbor()).not.toBe(cbor);
    }
  );
  it("refuses a missing datum", () => {
    expect(() => decodeOrderDatumData(undefined, false)).toThrow(/OrderDatum must be inline datum/);
  });
});

describe.each(v1.settings as { network: keyof typeof configs; settingsCbor: string; refSpendSettingsCbor: string; stakingAddresses: string[]; deploys: Record<string, Record<string, string | undefined>> }[])(
  "$network contracts and settings",
  ({ network, settingsCbor, refSpendSettingsCbor, stakingAddresses, deploys }) => {
    const c = configs[network];
    const isMainnet = network === "mainnet";
    const built = buildContracts({
      isMainnet,
      mint_version: c.MINT_VERSION,
      admin_verification_key_hash: c.ADMIN_VERIFICATION_KEY_HASH,
      orders_spend_randomizer: c.ORDERS_SPEND_RANDOMIZER,
      royalty_spend_admin: c.ROYALTY_SPEND_ADMIN,
    });

    it.each(CONTRACT_NAME_VALUES)("deploy(%s): applied script, datum, hash and addresses equal v1's", async (contractName) => {
      const d = await deploy({
        isMainnet,
        mintVersion: c.MINT_VERSION,
        adminVerificationKeyHash: c.ADMIN_VERIFICATION_KEY_HASH,
        ordersSpendRandomizer: c.ORDERS_SPEND_RANDOMIZER,
        royaltySpendAdmin: c.ROYALTY_SPEND_ADMIN,
        contractName,
      });
      const expected = deploys[contractName];
      expect(d.optimizedCbor).toBe(expected.optimizedCbor);
      expect(d.validatorHash).toBe(expected.validatorHash);
      expect(d.datumCbor).toBe(expected.datumCbor);
      expect(d.policyId).toBe(expected.policyId);
      expect(d.scriptAddress).toBe(expected.scriptAddress);
      expect(d.scriptStakingAddress).toBe(expected.scriptStakingAddress);
    });

    it("a different mint_version changes the policy id (negative control)", () => {
      const other = buildContracts({
        isMainnet,
        mint_version: c.MINT_VERSION + BigInt(1),
        admin_verification_key_hash: c.ADMIN_VERIFICATION_KEY_HASH,
        orders_spend_randomizer: c.ORDERS_SPEND_RANDOMIZER,
        royalty_spend_admin: c.ROYALTY_SPEND_ADMIN,
      });
      expect(other.halPolicyHash).not.toBe(deploys["halmntprx.mint"].policyId);
      expect(other.ordersSpend.ordersSpendValidatorHash).not.toBe(deploys["halord.spend"].validatorHash);
    });

    it("staking addresses equal v1's", () => {
      expect([built.mint.mintStakingAddress, built.refSpend.refSpendStakingAddress]).toEqual(stakingAddresses);
    });

    it("Settings / SettingsV1 datum round-trips byte-for-byte", () => {
      const settingsV1 = {
        policy_id: built.halPolicyHash,
        allowed_minter: c.ALLOWED_MINTER,
        hal_nft_price: c.HAL_NFT_PRICE,
        minting_data_script_hash: built.mintingData.mintingDataValidatorHash,
        orders_spend_script_hash: built.ordersSpend.ordersSpendValidatorHash,
        ref_spend_proxy_script_hash: built.refSpendProxy.refSpendProxyValidatorHash,
        ref_spend_governor: built.refSpend.refSpendValidatorHash,
        ref_spend_admin: c.REF_SPEND_ADMIN,
        royalty_spend_script_hash: built.royaltySpend.royaltySpendValidatorHash,
        minting_start_time: c.MINTING_START_TIME,
        payment_address: c.PAYMENT_ADDRESS,
      };
      const settings = { mint_governor: built.mint.mintValidatorHash, mint_version: c.MINT_VERSION, data: buildSettingsV1Data(settingsV1) };
      expect(buildSettingsData(settings).toCbor()).toBe(settingsCbor);
      const decoded = decodeSettingsDatum(fromCbor(settingsCbor));
      expect(decoded.mint_governor).toBe(settings.mint_governor);
      expect(decoded.mint_version).toBe(settings.mint_version);
      expect(decodeSettingsV1Data(decoded.data, isMainnet)).toEqual(settingsV1);
      expect(buildSettingsData({ ...settings, data: buildSettingsV1Data({ ...settingsV1, hal_nft_price: settingsV1.hal_nft_price + BigInt(1) }) }).toCbor()).not.toBe(settingsCbor);
    });

    it("RefSpendSettings datum round-trips byte-for-byte", () => {
      const refSpendSettingsV1 = { policy_id: built.halPolicyHash, ref_spend_admin: c.REF_SPEND_ADMIN };
      const refSpendSettings = { ref_spend_governor: built.refSpend.refSpendValidatorHash, data: buildRefSpendSettingsV1Data(refSpendSettingsV1) };
      expect(buildRefSpendSettingsData(refSpendSettings).toCbor()).toBe(refSpendSettingsCbor);
      const decoded = decodeRefSpendSettingsDatum(fromCbor(refSpendSettingsCbor));
      expect(decoded.ref_spend_governor).toBe(refSpendSettings.ref_spend_governor);
      expect(decodeRefSpendSettingsV1Data(decoded.data)).toEqual(refSpendSettingsV1);
    });
  }
);

describe("minting data, MPT proofs and whitelist values", () => {
  const md = v1.mintingData;
  const whitelistValue: WhitelistedValue = md.whitelistValue.map((w: { time_gap: number; amount: number; price: string }) => ({ ...w, price: BigInt(w.price) }));

  it("MintingData datum round-trips", () => {
    expect(buildMintingData(md.datum).toCbor()).toBe(md.datumCbor);
    expect(decodeMintingDataDatum(fromCbor(md.datumCbor))).toEqual(md.datum);
  });

  it("whitelisted value encodes and decodes as v1", () => {
    expect(makeWhitelistedValueData(whitelistValue).toCbor()).toBe(md.whitelistValueCbor);
    const decoded = decodeWhitelistedValueFromCBOR(Buffer.from(md.whitelistValueCbor, "hex"));
    expect(decoded.ok && decoded.data).toEqual(whitelistValue);
    expect(decodeWhitelistedValueFromCBOR("d87980").ok).toBe(false);
  });

  it("the Mint(proofs) redeemer — branch/fork/leaf steps, whitelist Some and None — equals v1's bytes", () => {
    const proofs = md.proofsJson.map(([hex, json]: [string, object]) => [hex, parseMPTProofJSON(json)]);
    const redeemer = buildMintingDataMintRedeemer([
      [proofs.slice(0, 2), [whitelistValue, parseMPTProofJSON(md.whitelistProofJson)]],
      [proofs.slice(2), undefined],
    ]);
    expect(redeemer.toCbor()).toBe(md.mintRedeemerCbor);
    // negative control: dropping the whitelist proof changes the redeemer
    expect(buildMintingDataMintRedeemer([[proofs.slice(0, 2), undefined], [proofs.slice(2), undefined]]).toCbor()).not.toBe(md.mintRedeemerCbor);
    expect(buildMintingDataUpdateMPTRedeemer().toCbor()).toBe(md.updateMptRedeemerCbor);
  });

  it("proofs regenerated from the same trie match the recorded ones (the fixture is not stale)", async () => {
    const names = Array.from({ length: 40 }, (_, i) => `H.A.L. - ${String(i).padStart(3, "0")}`);
    const db = await Trie.fromList(names.map((key) => ({ key, value: "" })));
    expect(db.hash.toString("hex")).toBe(md.datum.mpt_root_hash);
    expect((await db.prove(names[17])).toJSON()).toEqual(md.proofsJson[1][1]);
  });
});

describe("royalty datum and redeemers", () => {
  it("RoyaltyDatum (CIP-102) equals v1's bytes", () => {
    const datum = {
      recipients: [
        { address: addresses.previewBase, fee: 1.6, min_fee: BigInt(1_000_000), max_fee: undefined },
        { address: addresses.previewEnterprise, fee: 10, min_fee: undefined, max_fee: BigInt(50_000_000) },
      ],
      version: 1,
      extra: buildRoyaltyFlagCIP68ExtraData(),
    };
    expect(buildRoyaltyDatumData(datum).toCbor()).toBe(v1.royalty.datumCbor);
    expect(buildRoyaltyDatumData({ ...datum, version: 2 }).toCbor()).not.toBe(v1.royalty.datumCbor);
  });

  it("every redeemer equals v1's bytes", () => {
    const r = v1.redeemers;
    expect(buildMintMintNFTsRedeemer().toCbor()).toBe(r.mintNFTs);
    expect(buildMintBurnNFTsRedeemer().toCbor()).toBe(r.burnNFTs);
    expect(buildMintMintRoyaltyNFTRedeemer().toCbor()).toBe(r.mintRoyaltyNFT);
    expect(buildOrdersSpendExecuteOrdersRedeemer().toCbor()).toBe(r.executeOrders);
    expect(buildOrdersSpendCancelOrderRedeemer().toCbor()).toBe(r.cancelOrder);
    expect(buildOrdersSpendRefundOrderRedeemer().toCbor()).toBe(r.refundOrder);
    expect(buildRoyaltySpendUpdateRedeemer().toCbor()).toBe(r.royaltyUpdate);
    expect(buildRoyaltySpendMigrateRedeemer().toCbor()).toBe(r.royaltyMigrate);
    expect(makeVoidData().toCbor()).toBe(r.void);
  });
});
