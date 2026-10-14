import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { loadDesiredDeploymentState, parseDesiredDeploymentState } from "../src/deploymentState.js";

describe("hal deployment state", () => {
  it("loads desired-state YAML fixtures for all networks", async () => {
    const preview = await loadDesiredDeploymentState("deploy/preview/hal-minting.yaml");
    const preprod = await loadDesiredDeploymentState("deploy/preprod/hal-minting.yaml");
    const mainnet = await loadDesiredDeploymentState("deploy/mainnet/hal-minting.yaml");

    expect(preview.network).toBe("preview");
    expect(preprod.network).toBe("preprod");
    expect(mainnet.network).toBe("mainnet");
    expect(preview.schemaVersion).toBe(2);
    expect(preview.contracts).toHaveLength(7);
    expect(preview.assignedHandles.settings.halSettings).toBe("hal@handle_settings");
    expect(preview.assignedHandles.settings.refSpendSettings).toBeNull();
    expect(preview.ignoredSettings).toEqual([
      "settings.minting_data.mpt_root_hash",
      "settings.minting_data.whitelist_mpt_root_hash",
    ]);
  });

  it.each([
    ["deploy/preview/hal-minting.yaml", "deploy/preview/hal-minting.yaml"],
    [undefined, "desired deployment state"],
  ])("preserves the real YAML parse cause with context %s", (sourceLabel, expectedLabel) => {
    const raw = "network: [preview";
    let caught: unknown;
    try {
      parseDesiredDeploymentState(raw, sourceLabel);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error("Expected contextual YAML error", { cause: caught });
    }
    expect(caught.cause).toBeInstanceOf(YAML.YAMLParseError);
    if (!(caught.cause instanceof YAML.YAMLParseError)) {
      throw new Error("Expected original YAMLParseError cause", { cause: caught.cause });
    }
    expect(caught.cause.name).toBe("YAMLParseError");
    expect(caught.cause.code).toBe("BAD_INDENT");
    expect(caught.cause.pos).toEqual([17, 18]);
    expect(caught.cause.linePos).toEqual([{ line: 1, col: 18 }, { line: 1, col: 19 }]);
    expect(caught.message).toBe(`${expectedLabel} is not valid YAML: ${caught.cause.message}`);
    expect(caught.cause.message).toContain("Flow sequence in block collection must be sufficiently indented and end with a ]");
  });

  it("reports the loaded malformed YAML file path and original parser cause", async () => {
    const path = "tests/fixtures/desired-state-invalid.yaml";
    await expect(loadDesiredDeploymentState(path)).rejects.toMatchObject({
      message: expect.stringContaining(`${path} is not valid YAML: `),
      cause: expect.any(YAML.YAMLParseError),
    });
  });

  it("rejects a parsed non-object without inventing a YAML parse cause", () => {
    let caught: unknown;
    try {
      parseDesiredDeploymentState("[]", "desired-array.yaml");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error("Expected semantic deployment error", { cause: caught });
    }
    expect(caught.message).toBe("desired-array.yaml must be a YAML object");
    expect(caught.cause).toBeUndefined();
  });

  it("rejects observed-only fields in desired-state YAML", () => {
    expect(() =>
      parseDesiredDeploymentState(`
schema_version: 2
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
assigned_handles:
  settings:
    hal-settings: hal@handle_settings
    halref-settings: null
    halmntmpt-settings: hal_root@handle_settings
  scripts:
    halmntprx: hal_mnt_prxy@handle_contract
ignored_settings: []
contracts:
  - contract_slug: halmntprx
    script_type: halmntprx
    old_script_type: hal_mint_proxy
    deployment_handle_slug: halmntprx
    build:
      contract_name: halmntprx.mint
      kind: minting_policy
`)
    ).toThrow(/must not include observed-only field `current_script_hash`/);
  });
});
