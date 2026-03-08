import fs from "node:fs/promises";

import YAML from "yaml";

const ALLOWED_NETWORKS = new Set(["preview", "preprod", "mainnet"]);
const ALLOWED_BUILD_KINDS = new Set(["validator", "minting_policy"]);
const ALLOWED_SCRIPT_TYPES = new Set([
  "halmntprx",
  "halmnt",
  "halmntmpt",
  "halord",
  "halrefprx",
  "halref",
  "halroy",
]);
const ALLOWED_CONTRACT_SLUGS = new Set([
  "halmntprx",
  "halmnt",
  "halmntmpt",
  "halord",
  "halrefprx",
  "halref",
  "halroy",
]);
const OBSERVED_ONLY_FIELDS = new Set([
  "current_script_hash",
  "current_settings_utxo_ref",
  "current_subhandle",
  "observed_at",
  "last_deployed_tx_hash",
]);

export interface DesiredContractTarget {
  contractSlug: string;
  scriptType: string;
  oldScriptType: string | null;
  deploymentHandleSlug: string;
  build: {
    contractName: string;
    kind: "validator" | "minting_policy";
  };
}

interface DesiredAssignedHandles {
  settings: {
    halSettings: string | null;
    refSpendSettings: string | null;
    mintingData: string | null;
  };
  scripts: Record<string, string | null>;
}

export interface DesiredDeploymentState {
  schemaVersion: 2;
  network: "preview" | "preprod" | "mainnet";
  buildParameters: {
    mintVersion: number;
    adminVerificationKeyHash: string;
    ordersSpendRandomizer: string;
    royaltySpendAdmin: string;
  };
  settings: {
    halSettings: {
      allowedMinter: string;
      halNftPrice: number;
      paymentAddress: string;
      mintingStartTime: number;
    };
    refSpendSettings: {
      refSpendAdmin: string;
    };
    mintingData: {
      mptRootHash: string;
      whitelistMptRootHash: string;
    };
  };
  assignedHandles: DesiredAssignedHandles;
  ignoredSettings: string[];
  contracts: DesiredContractTarget[];
}

export const loadDesiredDeploymentState = async (
  path: string
): Promise<DesiredDeploymentState> => {
  const raw = await fs.readFile(path, "utf8");
  return parseDesiredDeploymentState(raw, path);
};

export const parseDesiredDeploymentState = (
  raw: string,
  sourceLabel = "desired deployment state"
): DesiredDeploymentState => {
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must be a YAML object`);
  }

  const value = parsed as Record<string, unknown>;
  const observedOnlyField = Object.keys(value).find((key) => OBSERVED_ONLY_FIELDS.has(key));
  if (observedOnlyField) {
    throw new Error(`${sourceLabel} must not include observed-only field \`${observedOnlyField}\``);
  }

  const schemaVersion = requireNumber(value, "schema_version", sourceLabel);
  if (schemaVersion !== 2) {
    throw new Error(`${sourceLabel} schema_version must equal 2`);
  }

  const network = requireString(value, "network", sourceLabel).toLowerCase();
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

  const buildParameters = requireObject(value, "build_parameters", sourceLabel);
  const settings = requireObject(value, "settings", sourceLabel);
  const assignedHandles = requireObject(value, "assigned_handles", sourceLabel);
  const contracts = requireArray(value, "contracts", sourceLabel).map((entry, index) =>
    parseContractTarget(entry, `${sourceLabel}.contracts[${index}]`)
  );

  const duplicates = new Set<string>();
  for (const contract of contracts) {
    if (duplicates.has(contract.contractSlug)) {
      throw new Error(`${sourceLabel}.contracts must not repeat contract_slug \`${contract.contractSlug}\``);
    }
    duplicates.add(contract.contractSlug);
  }

  return {
    schemaVersion: 2,
    network: network as "preview" | "preprod" | "mainnet",
    buildParameters: {
      mintVersion: requireNumber(buildParameters, "mint_version", `${sourceLabel}.build_parameters`),
      adminVerificationKeyHash: requireString(buildParameters, "admin_verification_key_hash", `${sourceLabel}.build_parameters`),
      ordersSpendRandomizer: requireString(buildParameters, "orders_spend_randomizer", `${sourceLabel}.build_parameters`),
      royaltySpendAdmin: requireString(buildParameters, "royalty_spend_admin", `${sourceLabel}.build_parameters`),
    },
    settings: {
      halSettings: parseHalSettings(requireObject(settings, "hal_settings", `${sourceLabel}.settings`), `${sourceLabel}.settings.hal_settings`),
      refSpendSettings: parseRefSpendSettings(requireObject(settings, "ref_spend_settings", `${sourceLabel}.settings`), `${sourceLabel}.settings.ref_spend_settings`),
      mintingData: parseMintingDataSettings(requireObject(settings, "minting_data", `${sourceLabel}.settings`), `${sourceLabel}.settings.minting_data`),
    },
    assignedHandles: parseAssignedHandles(assignedHandles, contracts, `${sourceLabel}.assigned_handles`),
    ignoredSettings: requireStringArrayAllowEmpty(value, "ignored_settings", sourceLabel),
    contracts,
  };
};

const parseContractTarget = (value: unknown, sourceLabel: string): DesiredContractTarget => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceLabel} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const contractSlug = requireShortHandleSlug(record, "contract_slug", sourceLabel);
  if (!ALLOWED_CONTRACT_SLUGS.has(contractSlug)) {
    throw new Error(`${sourceLabel}.contract_slug is not supported`);
  }
  const scriptType = requireShortHandleSlug(record, "script_type", sourceLabel);
  if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) {
    throw new Error(`${sourceLabel}.script_type is not supported`);
  }
  const deploymentHandleSlug = requireShortHandleSlug(record, "deployment_handle_slug", sourceLabel);
  if (contractSlug !== scriptType || scriptType !== deploymentHandleSlug) {
    throw new Error(
      `${sourceLabel} contract_slug, script_type, and deployment_handle_slug must match`
    );
  }
  const build = requireObject(record, "build", sourceLabel);
  const buildKind = requireString(build, "kind", `${sourceLabel}.build`);
  if (!ALLOWED_BUILD_KINDS.has(buildKind)) {
    throw new Error(`${sourceLabel}.build.kind must be validator or minting_policy`);
  }
  return {
    contractSlug,
    scriptType,
    oldScriptType: requireOptionalString(record, "old_script_type", sourceLabel),
    deploymentHandleSlug,
    build: {
      contractName: requireString(build, "contract_name", `${sourceLabel}.build`),
      kind: buildKind as "validator" | "minting_policy",
    },
  };
};

const parseHalSettings = (value: Record<string, unknown>, sourceLabel: string) => ({
  allowedMinter: requireString(value, "allowed_minter", sourceLabel),
  halNftPrice: requireNumber(value, "hal_nft_price", sourceLabel),
  paymentAddress: requireString(value, "payment_address", sourceLabel),
  mintingStartTime: requireNumber(value, "minting_start_time", sourceLabel),
});

const parseRefSpendSettings = (value: Record<string, unknown>, sourceLabel: string) => ({
  refSpendAdmin: requireString(value, "ref_spend_admin", sourceLabel),
});

const parseMintingDataSettings = (value: Record<string, unknown>, sourceLabel: string) => ({
  mptRootHash: requireString(value, "mpt_root_hash", sourceLabel),
  whitelistMptRootHash: requireString(value, "whitelist_mpt_root_hash", sourceLabel),
});

const parseAssignedHandles = (
  value: Record<string, unknown>,
  contracts: DesiredContractTarget[],
  sourceLabel: string
): DesiredAssignedHandles => {
  const settings = requireObject(value, "settings", sourceLabel);
  const scripts = requireObject(value, "scripts", sourceLabel);
  return {
    settings: {
      halSettings: requireNullableString(settings, "hal-settings", `${sourceLabel}.settings`),
      refSpendSettings: requireNullableString(settings, "halref-settings", `${sourceLabel}.settings`),
      mintingData: requireNullableString(settings, "halmntmpt-settings", `${sourceLabel}.settings`),
    },
    scripts: Object.fromEntries(
      contracts.map((contract) => [
        contract.contractSlug,
        requireNullableString(scripts, contract.contractSlug, `${sourceLabel}.scripts`),
      ])
    ),
  };
};

const requireArray = (value: Record<string, unknown>, key: string, sourceLabel: string): unknown[] => {
  const resolved = value[key];
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`${sourceLabel} must include non-empty array field \`${key}\``);
  }
  return resolved;
};

const requireObject = (value: Record<string, unknown>, key: string, sourceLabel: string): Record<string, unknown> => {
  const resolved = value[key];
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include object field \`${key}\``);
  }
  return resolved as Record<string, unknown>;
};

const requireString = (value: Record<string, unknown>, key: string, sourceLabel: string): string => {
  const resolved = value[key];
  if (typeof resolved !== "string") {
    throw new Error(`${sourceLabel} must include string field \`${key}\``);
  }
  return resolved;
};

const requireNullableString = (value: Record<string, unknown>, key: string, sourceLabel: string): string | null => {
  const resolved = value[key];
  if (resolved === null) {
    return null;
  }
  if (typeof resolved !== "string") {
    throw new Error(`${sourceLabel} must include string-or-null field \`${key}\``);
  }
  return resolved;
};

const requireNumber = (value: Record<string, unknown>, key: string, sourceLabel: string): number => {
  const resolved = value[key];
  if (typeof resolved !== "number" || Number.isNaN(resolved)) {
    throw new Error(`${sourceLabel} must include numeric field \`${key}\``);
  }
  return resolved;
};

const requireStringArrayAllowEmpty = (value: Record<string, unknown>, key: string, sourceLabel: string): string[] => {
  const resolved = value[key];
  if (!Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include array field \`${key}\``);
  }
  return resolved.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`${sourceLabel} must include string array field \`${key}\``);
    }
    return item;
  });
};

const requireShortHandleSlug = (value: Record<string, unknown>, key: string, sourceLabel: string): string => {
  const resolved = requireString(value, key, sourceLabel);
  if (resolved.length > 10) {
    throw new Error(`${sourceLabel}.${key} must be 10 characters or fewer`);
  }
  if (resolved.includes("-") || resolved.includes("_")) {
    throw new Error(`${sourceLabel}.${key} must not contain '-' or '_'`);
  }
  return resolved;
};

const requireOptionalString = (
  value: Record<string, unknown>,
  key: string,
  sourceLabel: string
): string | null => {
  const resolved = value[key];
  if (resolved === undefined || resolved === null) {
    return null;
  }
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw new Error(`${sourceLabel} must include string field \`${key}\``);
  }
  return resolved.trim();
};
