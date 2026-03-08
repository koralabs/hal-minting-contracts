import fs from "node:fs/promises";

import YAML from "yaml";

const ALLOWED_NETWORKS = new Set(["preview", "preprod", "mainnet"]);
const ALLOWED_BUILD_KINDS = new Set(["validator", "minting_policy"]);
const ALLOWED_SCRIPT_TYPES = new Set([
  "hal_mint_proxy",
  "hal_mint",
  "hal_minting_data",
  "hal_orders_spend",
  "hal_ref_spend_proxy",
  "hal_ref_spend",
  "hal_royalty_spend",
]);
const ALLOWED_CONTRACT_SLUGS = new Set([
  "hal-mint-proxy",
  "hal-mint",
  "hal-minting-data",
  "hal-orders-spend",
  "hal-ref-spend-proxy",
  "hal-ref-spend",
  "hal-royalty-spend",
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
  deploymentHandleSlug: string;
  build: {
    contractName: string;
    kind: "validator" | "minting_policy";
  };
}

export interface DesiredDeploymentState {
  schemaVersion: 1;
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
  if (schemaVersion !== 1) {
    throw new Error(`${sourceLabel} schema_version must equal 1`);
  }

  const network = requireString(value, "network", sourceLabel).toLowerCase();
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

  const buildParameters = requireObject(value, "build_parameters", sourceLabel);
  const settings = requireObject(value, "settings", sourceLabel);
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
    schemaVersion: 1,
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
    contracts,
  };
};

const parseContractTarget = (value: unknown, sourceLabel: string): DesiredContractTarget => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceLabel} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const contractSlug = requireString(record, "contract_slug", sourceLabel);
  if (!ALLOWED_CONTRACT_SLUGS.has(contractSlug)) {
    throw new Error(`${sourceLabel}.contract_slug is not supported`);
  }
  const scriptType = requireString(record, "script_type", sourceLabel);
  if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) {
    throw new Error(`${sourceLabel}.script_type is not supported`);
  }
  const build = requireObject(record, "build", sourceLabel);
  const buildKind = requireString(build, "kind", `${sourceLabel}.build`);
  if (!ALLOWED_BUILD_KINDS.has(buildKind)) {
    throw new Error(`${sourceLabel}.build.kind must be validator or minting_policy`);
  }
  return {
    contractSlug,
    scriptType,
    deploymentHandleSlug: requireString(record, "deployment_handle_slug", sourceLabel),
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

const requireNumber = (value: Record<string, unknown>, key: string, sourceLabel: string): number => {
  const resolved = value[key];
  if (typeof resolved !== "number" || Number.isNaN(resolved)) {
    throw new Error(`${sourceLabel} must include numeric field \`${key}\``);
  }
  return resolved;
};
