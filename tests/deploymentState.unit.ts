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

describe("hal deployment state validation", () => {
  const base = async () =>
    YAML.parse(await (await import("node:fs/promises")).readFile("deploy/preview/hal-minting.yaml", "utf8")) as Record<string, any>;
  const parse = (value: unknown) => parseDesiredDeploymentState(YAML.stringify(value), "state");

  it("accepts the unmodified fixture (negative control for every rejection below)", async () => {
    expect(parse(await base()).network).toBe("preview");
  });

  const cases: [string, (v: Record<string, any>) => void, string][] = [
    ["observed-only field", (v) => { v.observed_at = "x"; }, "must not include observed-only field `observed_at`"],
    ["schema version", (v) => { v.schema_version = 1; }, "schema_version must equal 2"],
    ["network", (v) => { v.network = "devnet"; }, "network must be one of"],
    ["empty contracts", (v) => { v.contracts = []; }, "non-empty array field `contracts`"],
    ["duplicate contract", (v) => { v.contracts.push(v.contracts[0]); }, "must not repeat contract_slug"],
    ["contract not object", (v) => { v.contracts[0] = "x"; }, "contracts[0] must be an object"],
    ["unsupported slug", (v) => { v.contracts[0].contract_slug = "bogus"; }, "contract_slug is not supported"],
    ["unsupported script type", (v) => { v.contracts[0].script_type = "bogus"; }, "script_type is not supported"],
    ["mismatched slugs", (v) => { v.contracts[0].script_type = "halmnt"; v.contracts[0].deployment_handle_slug = "halmnt"; }, "must match"],
    ["bad build kind", (v) => { v.contracts[0].build.kind = "script"; }, "build.kind must be validator or minting_policy"],
    ["long slug", (v) => { v.contracts[0].contract_slug = "halmntprx12345"; }, "10 characters or fewer"],
    ["slug with dash", (v) => { v.contracts[0].contract_slug = "hal-mnt"; }, "must not contain '-' or '_'"],
    ["blank old script type", (v) => { v.contracts[0].old_script_type = " "; }, "must include string field `old_script_type`"],
    ["non-string assigned handle", (v) => { v.assigned_handles.settings["hal-settings"] = 5; }, "string-or-null field `hal-settings`"],
    ["ignored settings not array", (v) => { v.ignored_settings = "x"; }, "array field `ignored_settings`"],
    ["ignored settings item", (v) => { v.ignored_settings = [1]; }, "string array field `ignored_settings`"],
    ["NaN number", (v) => { v.build_parameters.mint_version = "1"; }, "numeric field `mint_version`"],
    ["missing object", (v) => { delete v.settings; }, "object field `settings`"],
  ];

  it.each(cases)("rejects %s", async (_name, mutate, message) => {
    const v = await base();
    mutate(v);
    expect(() => parse(v)).toThrow(message);
  });

  it("rejects non-object YAML", () => {
    expect(() => parseDesiredDeploymentState("- a", "state")).toThrow("state must be a YAML object");
  });
});
