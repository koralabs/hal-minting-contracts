import crypto from "node:crypto";

import {
  makeAddress,
  makeAssetClass,
  makeAssets,
  makeInlineTxOutputDatum,
  makeTxInput,
  makeTxOutput,
  makeValue,
} from "@helios-lang/ledger";
import { decodeUplcData } from "@helios-lang/uplc";

import { LEGACY_POLICY_ID } from "./constants/index.js";
import { buildContracts } from "./contracts/config.js";
import {
  decodeMintingDataDatum,
  decodeRefSpendSettingsDatum,
  decodeRefSpendSettingsV1Data,
  decodeSettingsDatum,
  decodeSettingsV1Data,
} from "./contracts/index.js";
import type { DesiredContractTarget, DesiredDeploymentState } from "./deploymentState.js";

const REPO_NAME = "hal-minting-contracts";
const SETTINGS_HANDLE = "hal@handle_settings";
const REF_SPEND_SETTINGS_HANDLE = "hal_pz@handle_settings";
const MINTING_DATA_HANDLE = "hal_root@handle_settings";
const HANDLECONTRACT_NAMESPACE = "handlecontract";

interface ExpectedContractState {
  contractSlug: string;
  scriptType: string;
  expectedScriptHash: string;
}

interface LiveContractState {
  contractSlug: string;
  scriptType: string;
  currentScriptHash: string | null;
  currentSubhandle: string | null;
}

interface HandlePayload {
  utxo: string;
  hex: string;
  resolved_addresses?: {
    ada?: string;
  };
}

interface HandleUtxoPayload {
  lovelace?: number;
}

interface LiveSettingsState {
  halSettings: null | {
    values: {
      allowed_minter: string;
      hal_nft_price: number;
      minting_start_time: number;
      payment_address: string;
      policy_id: string;
      minting_data_script_hash: string;
      orders_spend_script_hash: string;
      ref_spend_proxy_script_hash: string;
      ref_spend_governor: string;
      ref_spend_admin: string;
      royalty_spend_script_hash: string;
    };
    mintGovernor: string;
    mintVersion: number;
  };
  refSpendSettings: null | {
    values: {
      policy_id: string;
      ref_spend_admin: string;
    };
    refSpendGovernor: string;
  };
  mintingData: null | {
    values: {
      mpt_root_hash: string;
      whitelist_mpt_root_hash: string;
    };
  };
}

const handlesApiBaseUrlForNetwork = (network: string): string => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

export const buildExpectedContractStates = (
  desired: DesiredDeploymentState,
  buildContractsFn = buildContracts
): ExpectedContractState[] => {
  const built = buildContractsFn({
    isMainnet: desired.network === "mainnet",
    mint_version: BigInt(desired.buildParameters.mintVersion),
    admin_verification_key_hash: desired.buildParameters.adminVerificationKeyHash,
    orders_spend_randomizer: desired.buildParameters.ordersSpendRandomizer,
    royalty_spend_admin: desired.buildParameters.royaltySpendAdmin,
  });

  return desired.contracts.map((contract) => ({
    contractSlug: contract.contractSlug,
    scriptType: contract.scriptType,
    expectedScriptHash: expectedScriptHashForContract(contract, built),
  }));
};

const expectedScriptHashForContract = (
  contract: DesiredContractTarget,
  built: ReturnType<typeof buildContracts>
): string => {
  switch (contract.build.contractName) {
    case "mint_proxy.mint":
      return built.mintProxy.mintProxyPolicyHash.toHex();
    case "mint.withdraw":
      return built.mint.mintValidatorHash.toHex();
    case "minting_data.spend":
      return built.mintingData.mintingDataValidatorHash.toHex();
    case "orders_spend.spend":
      return built.ordersSpend.ordersSpendValidatorHash.toHex();
    case "ref_spend_proxy.spend":
      return built.refSpendProxy.refSpendProxyValidatorHash.toHex();
    case "ref_spend.withdraw":
      return built.refSpend.refSpendValidatorHash.toHex();
    case "royalty_spend.spend":
      return built.royaltySpend.royaltySpendValidatorHash.toHex();
    default:
      throw new Error(`unsupported contract_name \`${contract.build.contractName}\``);
  }
};

export const fetchLiveContractStates = async ({
  network,
  contracts,
  userAgent,
  fetchFn = fetch,
}: {
  network: "preview" | "preprod" | "mainnet";
  contracts: DesiredContractTarget[];
  userAgent: string;
  fetchFn?: typeof fetch;
}): Promise<LiveContractState[]> => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  return Promise.all(
    contracts.map(async (contract) => {
      const response = await fetchFn(
        `${baseUrl}/scripts?latest=true&type=${encodeURIComponent(contract.scriptType)}`,
        { headers: { "User-Agent": userAgent } }
      );
      if (response.status === 404) {
        return {
          contractSlug: contract.contractSlug,
          scriptType: contract.scriptType,
          currentScriptHash: null,
          currentSubhandle: null,
        };
      }
      if (!response.ok) {
        throw new Error(`failed to load live ${contract.contractSlug} script: HTTP ${response.status}`);
      }
      const payload = await response.json();
      const currentScriptHash = String(payload.validatorHash ?? payload.scriptHash ?? "").trim() || null;
      return {
        contractSlug: contract.contractSlug,
        scriptType: contract.scriptType,
        currentScriptHash,
        currentSubhandle: String(payload.handle ?? "").trim() || null,
      };
    })
  );
};

export const fetchLiveSettingsState = async ({
  network,
  userAgent,
  fetchFn = fetch,
}: {
  network: "preview" | "preprod" | "mainnet";
  userAgent: string;
  fetchFn?: typeof fetch;
}): Promise<LiveSettingsState> => {
  const isMainnet = network === "mainnet";
  return {
    halSettings: await fetchHalSettings({ network, isMainnet, userAgent, fetchFn }),
    refSpendSettings: await fetchRefSpendSettings({ network, userAgent, fetchFn }),
    mintingData: await fetchMintingData({ network, userAgent, fetchFn }),
  };
};

const fetchHalSettings = async ({
  network,
  isMainnet,
  userAgent,
  fetchFn,
}: {
  network: string;
  isMainnet: boolean;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const handle = await fetchHandleJson({ network, handleName: SETTINGS_HANDLE, userAgent, fetchFn });
  if (!handle) return null;
  const datumHex = await fetchHandleDatum({ network, handleName: SETTINGS_HANDLE, userAgent, fetchFn });
  if (!datumHex) return null;
  const txInput = makeTxInput(
    String(handle.utxo),
    makeTxOutput(
      makeAddress(String(handle.resolved_addresses?.ada)),
      makeValue(1n, makeAssets([[makeAssetClass(`${LEGACY_POLICY_ID}.${String(handle.hex)}`), 1n]])),
      makeInlineTxOutputDatum(decodeUplcData(datumHex))
    )
  );
  const settings = decodeSettingsDatum(txInput.datum);
  const settingsV1 = decodeSettingsV1Data(settings.data, isMainnet);
  return {
    values: {
      allowed_minter: settingsV1.allowed_minter,
      hal_nft_price: Number(settingsV1.hal_nft_price),
      minting_start_time: settingsV1.minting_start_time,
      payment_address: settingsV1.payment_address.toString(),
      policy_id: settingsV1.policy_id,
      minting_data_script_hash: settingsV1.minting_data_script_hash,
      orders_spend_script_hash: settingsV1.orders_spend_script_hash,
      ref_spend_proxy_script_hash: settingsV1.ref_spend_proxy_script_hash,
      ref_spend_governor: settingsV1.ref_spend_governor,
      ref_spend_admin: settingsV1.ref_spend_admin,
      royalty_spend_script_hash: settingsV1.royalty_spend_script_hash,
    },
    mintGovernor: settings.mint_governor,
    mintVersion: Number(settings.mint_version),
  };
};

const fetchRefSpendSettings = async ({
  network,
  userAgent,
  fetchFn,
}: {
  network: string;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const handle = await fetchHandleJson({ network, handleName: REF_SPEND_SETTINGS_HANDLE, userAgent, fetchFn });
  if (!handle || !handle.resolved_addresses?.ada) return null;
  const datumHex = await fetchHandleDatum({ network, handleName: REF_SPEND_SETTINGS_HANDLE, userAgent, fetchFn });
  if (!datumHex) return null;
  const txInput = makeTxInput(
    String(handle.utxo),
    makeTxOutput(
      makeAddress(String(handle.resolved_addresses.ada)),
      makeValue(1n, makeAssets([[makeAssetClass(`${LEGACY_POLICY_ID}.${String(handle.hex)}`), 1n]])),
      makeInlineTxOutputDatum(decodeUplcData(datumHex))
    )
  );
  const settings = decodeRefSpendSettingsDatum(txInput.datum);
  const settingsV1 = decodeRefSpendSettingsV1Data(settings.data);
  return {
    values: {
      policy_id: settingsV1.policy_id,
      ref_spend_admin: settingsV1.ref_spend_admin,
    },
    refSpendGovernor: settings.ref_spend_governor,
  };
};

const fetchMintingData = async ({
  network,
  userAgent,
  fetchFn,
}: {
  network: string;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const handle = await fetchHandleJson({ network, handleName: MINTING_DATA_HANDLE, userAgent, fetchFn });
  if (!handle || !handle.resolved_addresses?.ada) return null;
  const utxo = await fetchHandleUtxo({ network, handleName: MINTING_DATA_HANDLE, userAgent, fetchFn });
  const datumHex = await fetchHandleDatum({ network, handleName: MINTING_DATA_HANDLE, userAgent, fetchFn });
  if (!utxo || !datumHex) return null;
  const txInput = makeTxInput(
    String(handle.utxo),
    makeTxOutput(
      makeAddress(String(handle.resolved_addresses.ada)),
      makeValue(BigInt(Number(utxo.lovelace ?? 0)), makeAssets([[makeAssetClass(`${LEGACY_POLICY_ID}.${String(handle.hex)}`), 1n]])),
      makeInlineTxOutputDatum(decodeUplcData(datumHex))
    )
  );
  const mintingData = decodeMintingDataDatum(txInput.datum);
  return {
    values: {
      mpt_root_hash: mintingData.mpt_root_hash,
      whitelist_mpt_root_hash: mintingData.whitelist_mpt_root_hash,
    },
  };
};

const fetchHandleJson = async ({
  network,
  handleName,
  userAgent,
  fetchFn,
}: {
  network: string;
  handleName: string;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const response = await fetchFn(
    `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handleName)}`,
    { headers: { "User-Agent": userAgent } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`failed to load handle ${handleName}: HTTP ${response.status}`);
  }
  return response.json() as Promise<HandlePayload>;
};

const fetchHandleDatum = async ({
  network,
  handleName,
  userAgent,
  fetchFn,
}: {
  network: string;
  handleName: string;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const response = await fetchFn(
    `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handleName)}/datum`,
    { headers: { "User-Agent": userAgent } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`failed to load datum for ${handleName}: HTTP ${response.status}`);
  }
  return (await response.text()).trim() || null;
};

const fetchHandleUtxo = async ({
  network,
  handleName,
  userAgent,
  fetchFn,
}: {
  network: string;
  handleName: string;
  userAgent: string;
  fetchFn: typeof fetch;
}) => {
  const response = await fetchFn(
    `${handlesApiBaseUrlForNetwork(network)}/handles/${encodeURIComponent(handleName)}/utxo`,
    { headers: { "User-Agent": userAgent } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`failed to load utxo for ${handleName}: HTTP ${response.status}`);
  }
  return response.json() as Promise<HandleUtxoPayload>;
};

const expectedSettingsState = (
  desired: DesiredDeploymentState,
  expectedContracts: ExpectedContractState[]
) => {
  const scriptHashFor = (contractSlug: string) => {
    const contract = expectedContracts.find((item) => item.contractSlug === contractSlug);
    if (!contract) {
      throw new Error(`missing expected contract ${contractSlug}`);
    }
    return contract.expectedScriptHash;
  };

  return {
    halSettings: {
      mint_governor: scriptHashFor("hal-mint"),
      mint_version: desired.buildParameters.mintVersion,
      values: {
        policy_id: scriptHashFor("hal-mint-proxy"),
        allowed_minter: desired.settings.halSettings.allowedMinter,
        hal_nft_price: desired.settings.halSettings.halNftPrice,
        minting_data_script_hash: scriptHashFor("hal-minting-data"),
        orders_spend_script_hash: scriptHashFor("hal-orders-spend"),
        ref_spend_proxy_script_hash: scriptHashFor("hal-ref-spend-proxy"),
        ref_spend_governor: scriptHashFor("hal-ref-spend"),
        ref_spend_admin: desired.settings.refSpendSettings.refSpendAdmin,
        royalty_spend_script_hash: scriptHashFor("hal-royalty-spend"),
        minting_start_time: desired.settings.halSettings.mintingStartTime,
        payment_address: desired.settings.halSettings.paymentAddress,
      },
    },
    refSpendSettings: {
      ref_spend_governor: scriptHashFor("hal-ref-spend"),
      values: {
        policy_id: scriptHashFor("hal-mint-proxy"),
        ref_spend_admin: desired.settings.refSpendSettings.refSpendAdmin,
      },
    },
    mintingData: {
      values: {
        mpt_root_hash: desired.settings.mintingData.mptRootHash,
        whitelist_mpt_root_hash: desired.settings.mintingData.whitelistMptRootHash,
      },
    },
  };
};

export const discoverNextContractSubhandles = async ({
  network,
  contracts,
  userAgent,
  fetchFn = fetch,
}: {
  network: "preview" | "preprod" | "mainnet";
  contracts: DesiredContractTarget[];
  userAgent: string;
  fetchFn?: typeof fetch;
}) => {
  const entries = await Promise.all(
    contracts.map(async (contract) => [
      contract.contractSlug,
      await discoverNextContractSubhandle({
        network,
        deploymentHandleSlug: contract.deploymentHandleSlug,
        userAgent,
        fetchFn,
      }),
    ] as const)
  );
  return Object.fromEntries(entries) as Record<string, string>;
};

const discoverNextContractSubhandle = async ({
  network,
  deploymentHandleSlug,
  userAgent,
  fetchFn = fetch,
}: {
  network: string;
  deploymentHandleSlug: string;
  userAgent: string;
  fetchFn?: typeof fetch;
}): Promise<string> => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${deploymentHandleSlug}${ordinal}@${HANDLECONTRACT_NAMESPACE}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) {
      return candidate;
    }
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
  }
  throw new Error(`no available SubHandle found for ${deploymentHandleSlug}@${HANDLECONTRACT_NAMESPACE}`);
};

export const buildDeploymentPlan = ({
  desired,
  expectedContracts,
  liveContracts,
  liveSettings,
  nextSubhandles,
}: {
  desired: DesiredDeploymentState;
  expectedContracts: ExpectedContractState[];
  liveContracts: LiveContractState[];
  liveSettings: LiveSettingsState;
  nextSubhandles: Record<string, string>;
}) => {
  const expectedSettings = expectedSettingsState(desired, expectedContracts);
  const contractEntries = desired.contracts.map((contract) => {
    const expected = expectedContracts.find((item) => item.contractSlug === contract.contractSlug);
    const live = liveContracts.find((item) => item.contractSlug === contract.contractSlug);
    if (!expected || !live) {
      throw new Error(`missing expected/live contract state for ${contract.contractSlug}`);
    }
    const driftType = live.currentScriptHash === expected.expectedScriptHash ? "no_change" : "script_hash_only";
    const replacementSubhandle = nextSubhandles[contract.contractSlug] || null;
    return {
      contract_slug: contract.contractSlug,
      script_type: contract.scriptType,
      drift_type: driftType,
      script_hashes: {
        current: live.currentScriptHash,
        expected: expected.expectedScriptHash,
      },
      subhandle: {
        action: driftType === "no_change" ? "reuse" : "allocate",
        value: driftType === "no_change" ? live.currentSubhandle : replacementSubhandle,
        is_new: driftType !== "no_change",
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: contract.contractSlug,
        expected_script_hash: expected.expectedScriptHash,
        expected_subhandle: driftType === "no_change" ? live.currentSubhandle : replacementSubhandle,
      },
    };
  });

  const settingsEntries = [
    {
      contract_slug: "hal-settings",
      drift_type: settingsDriftType(liveSettings.halSettings, expectedSettings.halSettings),
      settings: {
        type: "hal_settings",
        diff_rows: diffRows(liveSettings.halSettings, expectedSettings.halSettings),
        desired_values: expectedSettings.halSettings.values,
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "hal-settings",
        settings: {
          type: "hal_settings",
          values: expectedSettings.halSettings.values,
        },
      },
    },
    {
      contract_slug: "hal-ref-spend-settings",
      drift_type: settingsDriftType(liveSettings.refSpendSettings, expectedSettings.refSpendSettings),
      settings: {
        type: "hal_ref_spend_settings",
        diff_rows: diffRows(liveSettings.refSpendSettings, expectedSettings.refSpendSettings),
        desired_values: expectedSettings.refSpendSettings.values,
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "hal-ref-spend-settings",
        settings: {
          type: "hal_ref_spend_settings",
          values: expectedSettings.refSpendSettings.values,
        },
      },
    },
    {
      contract_slug: "hal-minting-data-settings",
      drift_type: settingsDriftType(liveSettings.mintingData, expectedSettings.mintingData),
      settings: {
        type: "hal_minting_data",
        diff_rows: diffRows(liveSettings.mintingData, expectedSettings.mintingData),
        desired_values: expectedSettings.mintingData.values,
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "hal-minting-data-settings",
        settings: {
          type: "hal_minting_data",
          values: expectedSettings.mintingData.values,
        },
      },
    },
  ];

  const allEntries = [...contractEntries, ...settingsEntries];
  const planId = crypto.createHash("sha256").update(JSON.stringify({
    network: desired.network,
    build_parameters: desired.buildParameters,
    contracts: contractEntries.map((entry) => ({
      contract_slug: entry.contract_slug,
      current: entry.script_hashes.current,
      expected: entry.script_hashes.expected,
      next_subhandle: entry.subhandle.value,
    })),
    settings: settingsEntries.map((entry) => ({
      contract_slug: entry.contract_slug,
      desired_values: entry.settings.desired_values,
      diff_rows: entry.settings.diff_rows,
    })),
  })).digest("hex");

  const summaryJson = {
    plan_id: planId,
    repo: REPO_NAME,
    network: desired.network,
    contracts: allEntries,
    transaction_order: [],
  };

  const summaryMarkdown = [
    "# Contract Deployment Plan",
    "",
    `- Plan ID: \`${planId}\``,
    `- Repo: \`${REPO_NAME}\``,
    `- Network: \`${desired.network}\``,
    "",
    "## Contract Drift",
    ...contractEntries.flatMap((entry) => [
      `- \`${entry.contract_slug}\`: \`${entry.drift_type}\``,
      `  - Script Hash: \`${entry.script_hashes.current || ""}\` -> \`${entry.script_hashes.expected}\``,
      `  - Handle: \`${entry.subhandle.value || ""}\``,
    ]),
    "",
    "## Settings Drift",
    ...settingsEntries.flatMap((entry) => [
      `- \`${entry.contract_slug}\`: \`${entry.drift_type}\``,
      ...(entry.settings.diff_rows.length > 0
        ? entry.settings.diff_rows.map((row) => `  - \`${row.path}\``)
        : ["  - No settings changes."])
    ]),
    "",
    "## Transaction Order",
    "- No transaction artifact is generated for this repo yet.",
  ].join("\n");

  return {
    planId,
    summaryJson,
    summaryMarkdown,
    deploymentPlanJson: {
      plan_id: planId,
      repo: REPO_NAME,
      network: desired.network,
      contracts: allEntries.map((entry) => entry.expected_post_deploy_state),
      transaction_order: [],
    },
  };
};

const settingsDriftType = (current: Record<string, unknown> | null, expected: Record<string, unknown>) =>
  diffRows(current, expected).length > 0 ? "settings_only" : "no_change";

const diffRows = (current: Record<string, unknown> | null, expected: Record<string, unknown>) => {
  if (!current) {
    return [{ path: "missing_live_state", current: null, desired: expected }];
  }
  const rows: { path: string; current: unknown; desired: unknown }[] = [];
  collectDiffRows(rows, current, expected);
  return rows;
};

const collectDiffRows = (
  rows: { path: string; current: unknown; desired: unknown }[],
  current: unknown,
  expected: unknown,
  prefix = ""
) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const currentRecord = current && typeof current === "object" && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {};
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      collectDiffRows(rows, currentRecord[key], value, prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  if (current !== expected) {
    rows.push({ path: prefix, current, desired: expected });
  }
};
