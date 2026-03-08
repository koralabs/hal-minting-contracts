import { describe, expect, it } from "vitest";

import { loadDesiredDeploymentState, parseDesiredDeploymentState } from "../src/deploymentState.js";

describe("hal deployment state", () => {
  it("loads desired-state YAML fixtures for all networks", async () => {
    const preview = await loadDesiredDeploymentState("deploy/preview/hal-minting.yaml");
    const preprod = await loadDesiredDeploymentState("deploy/preprod/hal-minting.yaml");
    const mainnet = await loadDesiredDeploymentState("deploy/mainnet/hal-minting.yaml");

    expect(preview.network).toBe("preview");
    expect(preprod.network).toBe("preprod");
    expect(mainnet.network).toBe("mainnet");
    expect(preview.contracts).toHaveLength(7);
  });

  it("rejects observed-only fields in desired-state YAML", () => {
    expect(() =>
      parseDesiredDeploymentState(`
schema_version: 1
network: preview
current_script_hash: deadbeef
build_parameters:
  mint_version: 0
  admin_verification_key_hash: aa
  orders_spend_randomizer: ""
  royalty_spend_admin: bb
settings:
  hal_settings:
    allowed_minter: cc
    hal_nft_price: 1
    payment_address: addr_test1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq
    minting_start_time: 2
  ref_spend_settings:
    ref_spend_admin: dd
  minting_data:
    mpt_root_hash: ee
    whitelist_mpt_root_hash: ff
contracts:
  - contract_slug: hal-mint-proxy
    script_type: hal_mint_proxy
    deployment_handle_slug: halmntprxy
    build:
      contract_name: mint_proxy.mint
      kind: minting_policy
`)
    ).toThrow(/must not include observed-only field `current_script_hash`/);
  });
});
