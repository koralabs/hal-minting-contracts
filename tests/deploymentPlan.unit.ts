import { describe, expect, it, vi } from "vitest";

import {
  buildDeploymentPlan,
  buildExpectedContractStates,
  discoverNextContractSubhandles,
  fetchLiveContractStates,
  fetchLiveSettingsState,
} from "../src/deploymentPlan.js";
import type { DesiredDeploymentState } from "../src/deploymentState.js";

const desiredState: DesiredDeploymentState = {
  schemaVersion: 1,
  network: "preview",
  buildParameters: {
    mintVersion: 0,
    adminVerificationKeyHash: "admin",
    ordersSpendRandomizer: "",
    royaltySpendAdmin: "royalty-admin",
  },
  settings: {
    halSettings: {
      allowedMinter: "allowed",
      halNftPrice: 30,
      paymentAddress: "addr_test1qpz",
      mintingStartTime: 123,
    },
    refSpendSettings: {
      refSpendAdmin: "ref-admin",
    },
    mintingData: {
      mptRootHash: "root-a",
      whitelistMptRootHash: "root-b",
    },
  },
  contracts: [
    {
      contractSlug: "hal-mint-proxy",
      scriptType: "hal_mint_proxy",
      deploymentHandleSlug: "halmntprxy",
      build: { contractName: "mint_proxy.mint", kind: "minting_policy" },
    },
    {
      contractSlug: "hal-mint",
      scriptType: "hal_mint",
      deploymentHandleSlug: "halmnt",
      build: { contractName: "mint.withdraw", kind: "validator" },
    },
  ],
};

describe("hal deployment plan", () => {
  it("derives expected script hashes from buildContracts output", () => {
    const expected = buildExpectedContractStates(
      desiredState,
      vi.fn(() => ({
        mintProxy: { mintProxyPolicyHash: { toHex: () => "aa" } },
        mint: { mintValidatorHash: { toHex: () => "bb" } },
        mintingData: { mintingDataValidatorHash: { toHex: () => "cc" } },
        ordersSpend: { ordersSpendValidatorHash: { toHex: () => "dd" } },
        refSpendProxy: { refSpendProxyValidatorHash: { toHex: () => "ee" } },
        refSpend: { refSpendValidatorHash: { toHex: () => "ff" } },
        royaltySpend: { royaltySpendValidatorHash: { toHex: () => "gg" } },
      })) as never
    );

    expect(expected).toEqual([
      { contractSlug: "hal-mint-proxy", scriptType: "hal_mint_proxy", expectedScriptHash: "aa" },
      { contractSlug: "hal-mint", scriptType: "hal_mint", expectedScriptHash: "bb" },
    ]);
  });

  it("treats missing live scripts and handles as drift instead of failing", async () => {
    const live = await fetchLiveContractStates({
      network: "preview",
      contracts: desiredState.contracts,
      userAgent: "codex-test",
      fetchFn: vi.fn(async (url) => {
        if (String(url).includes("hal_mint_proxy")) {
          return new Response(null, { status: 404 });
        }
        return new Response(JSON.stringify({ validatorHash: "bb", handle: "hal-mint1@handlecontract" }), { status: 200 });
      }) as typeof fetch,
    });

    expect(live).toEqual([
      { contractSlug: "hal-mint-proxy", scriptType: "hal_mint_proxy", currentScriptHash: null, currentSubhandle: null },
      { contractSlug: "hal-mint", scriptType: "hal_mint", currentScriptHash: "bb", currentSubhandle: "hal-mint1@handlecontract" },
    ]);
  });

  it("loads settings handles and tolerates missing ref-spend settings", async () => {
    const fetchFn = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("hal%40handle_settings/datum")) {
        return new Response("d8799f581c608634513520c1ede320bdc04e0eb8877565d21de0e52273632e8fa304d8799f581c171e700eae9a90a34ecbd5c8bbf8caf7e6c71f0d5799d8875cbb93a2581c4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e11a01c9c380581c341a868958480a390394cac63853b1a71807cea61d2052fd2d7a8a7d581c87b7d83732787c5692a5973dd5b02447406224106ba22763ee8368d6581c39ce168123ee1cbde43c8b64ae13d7e654078e9e406e6d4a9129991b581cb0b567bc246c1e70db63410bcaf844bd6adc5233fa6ce108b99d9317581c4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1581cb9743ca183e37b7d6a41cb9677782f9a06059d8b6bb1369dcc60826b1b000001993afc6f50d8799fd8799f581ca5ab40f280d88ae5904ec8df30974f10168854efafd4ecfce528092effd8799fd8799fd8799f581c2b56488a980d0ea62ba2b239c16f9524664d5cbb2a13b77ceab4b40cffffffffffff", { status: 200 });
      }
      if (target.includes("hal%40handle_settings")) {
        return new Response(JSON.stringify({ utxo: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#0", hex: "abcd", resolved_addresses: { ada: "addr_test1qz96txepzdhj7ryyse0mq9a97eey2es07dydshr9cgapgyv06l2rv7x0p0vtg5kufwj3avaa909ex8uswsnxnad9ccqsyaga0j" } }), { status: 200 });
      }
      if (target.includes("hal_pz%40handle_settings")) {
        return new Response(null, { status: 404 });
      }
      if (target.includes("hal_root%40handle_settings/utxo")) {
        return new Response(JSON.stringify({ lovelace: 3 }), { status: 200 });
      }
      if (target.includes("hal_root%40handle_settings/datum")) {
        return new Response("d8799f582064130d0cada93f6e61accbda58c11e1f171ddc38a5ba9728e1178e64c7ad12fd58205a37927993f0c9906abcfa65ee46daa7cdab87829a1b3debdb173e66cd25c112ff", { status: 200 });
      }
      if (target.includes("hal_root%40handle_settings")) {
        return new Response(JSON.stringify({ utxo: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb#1", hex: "ef01", resolved_addresses: { ada: "addr_test1wq6p4p5ftpyq5wgrjn9vvwznkxn3sp7w5cwjq5ha94ag5lg2m5g0g" } }), { status: 200 });
      }
      throw new Error(`unexpected url ${target}`);
    }) as typeof fetch;

    const liveSettings = await fetchLiveSettingsState({
      network: "preview",
      userAgent: "codex-test",
      fetchFn,
    });

    expect(liveSettings.halSettings?.values.allowed_minter).toBe("4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1");
    expect(liveSettings.refSpendSettings).toBeNull();
    expect(liveSettings.mintingData?.values.mpt_root_hash).toBe("64130d0cada93f6e61accbda58c11e1f171ddc38a5ba9728e1178e64c7ad12fd");
  });

  it("builds script and settings drift summary entries", () => {
    const plan = buildDeploymentPlan({
      desired: desiredState,
      expectedContracts: [
        { contractSlug: "hal-mint-proxy", scriptType: "hal_mint_proxy", expectedScriptHash: "aa" },
        { contractSlug: "hal-mint", scriptType: "hal_mint", expectedScriptHash: "bb" },
        { contractSlug: "hal-minting-data", scriptType: "hal_minting_data", expectedScriptHash: "cc" },
        { contractSlug: "hal-orders-spend", scriptType: "hal_orders_spend", expectedScriptHash: "dd" },
        { contractSlug: "hal-ref-spend-proxy", scriptType: "hal_ref_spend_proxy", expectedScriptHash: "ee" },
        { contractSlug: "hal-ref-spend", scriptType: "hal_ref_spend", expectedScriptHash: "ff" },
        { contractSlug: "hal-royalty-spend", scriptType: "hal_royalty_spend", expectedScriptHash: "gg" },
      ],
      liveContracts: [
        { contractSlug: "hal-mint-proxy", scriptType: "hal_mint_proxy", currentScriptHash: null, currentSubhandle: null },
        { contractSlug: "hal-mint", scriptType: "hal_mint", currentScriptHash: "bb", currentSubhandle: "hal-mint1@handlecontract" },
      ],
      liveSettings: {
        halSettings: null,
        refSpendSettings: null,
        mintingData: { values: { mpt_root_hash: "root-a", whitelist_mpt_root_hash: "mismatch" } },
      },
      nextSubhandles: {
        "hal-mint-proxy": "halmntprxy1@handlecontract",
        "hal-mint": "halmnt2@handlecontract",
        "hal-minting-data": "halmntdata1@handlecontract",
        "hal-orders-spend": "halordspnd1@handlecontract",
        "hal-ref-spend-proxy": "halrfsdpx1@handlecontract",
        "hal-ref-spend": "halrefspnd1@handlecontract",
        "hal-royalty-spend": "halroyspnd1@handlecontract",
      },
    });

    expect(plan.summaryJson.contracts.map((item) => item.contract_slug)).toEqual([
      "hal-mint-proxy",
      "hal-mint",
      "hal-settings",
      "hal-ref-spend-settings",
      "hal-minting-data-settings",
    ]);
    expect(plan.summaryJson.contracts[0].subhandle.value).toBe("halmntprxy1@handlecontract");
    expect(plan.summaryJson.contracts[2].drift_type).toBe("settings_only");
    expect(plan.summaryMarkdown).toContain("hal-settings");
  });

  it("discovers the next ordinalized handlecontract name", async () => {
    const subhandles = await discoverNextContractSubhandles({
      network: "preview",
      contracts: desiredState.contracts,
      userAgent: "codex-test",
      fetchFn: vi.fn(async (url) => {
        const target = String(url);
        if (target.includes("halmntprxy1%40handlecontract")) return new Response(null, { status: 200 });
        if (target.includes("halmntprxy2%40handlecontract")) return new Response(null, { status: 404 });
        if (target.includes("halmnt1%40handlecontract")) return new Response(null, { status: 404 });
        throw new Error(`unexpected url ${target}`);
      }) as typeof fetch,
    });

    expect(subhandles).toEqual({
      "hal-mint-proxy": "halmntprxy2@handlecontract",
      "hal-mint": "halmnt1@handlecontract",
    });
  });
});
