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
    case "halmntprx.mint":
      return built.mintProxy.mintProxyPolicyHash.toHex();
    case "halmnt.withdraw":
      return built.mint.mintValidatorHash.toHex();
    case "halmntmpt.spend":
      return built.mintingData.mintingDataValidatorHash.toHex();
    case "halord.spend":
      return built.ordersSpend.ordersSpendValidatorHash.toHex();
    case "halrefprx.spend":
      return built.refSpendProxy.refSpendProxyValidatorHash.toHex();
    case "halref.withdraw":
      return built.refSpend.refSpendValidatorHash.toHex();
    case "halroy.spend":
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
        `${baseUrl}/scripts?latest=true&type=${encodeURIComponent(contract.oldScriptType ?? contract.scriptType)}`,
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
      mint_governor: scriptHashFor("halmnt"),
      mint_version: desired.buildParameters.mintVersion,
      values: {
        policy_id: scriptHashFor("halmntprx"),
        allowed_minter: desired.settings.halSettings.allowedMinter,
        hal_nft_price: desired.settings.halSettings.halNftPrice,
        minting_data_script_hash: scriptHashFor("halmntmpt"),
        orders_spend_script_hash: scriptHashFor("halord"),
        ref_spend_proxy_script_hash: scriptHashFor("halrefprx"),
        ref_spend_governor: scriptHashFor("halref"),
        ref_spend_admin: desired.settings.refSpendSettings.refSpendAdmin,
        royalty_spend_script_hash: scriptHashFor("halroy"),
        minting_start_time: desired.settings.halSettings.mintingStartTime,
        payment_address: desired.settings.halSettings.paymentAddress,
      },
    },
    refSpendSettings: {
      ref_spend_governor: scriptHashFor("halref"),
      values: {
        policy_id: scriptHashFor("halmntprx"),
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
  liveContracts = [],
  userAgent,
  fetchFn = fetch,
}: {
  network: "preview" | "preprod" | "mainnet";
  contracts: DesiredContractTarget[];
  liveContracts?: LiveContractState[];
  userAgent: string;
  fetchFn?: typeof fetch;
}) => {
  const entries = await Promise.all(
    contracts.map(async (contract) => {
      const liveContract = liveContracts.find((item) => item.contractSlug === contract.contractSlug);
      return [
        contract.contractSlug,
        await discoverNextContractSubhandle({
          network,
          deploymentHandleSlug: contract.deploymentHandleSlug,
          currentSubhandle: liveContract?.currentSubhandle ?? null,
          userAgent,
          fetchFn,
        }),
      ] as const;
    })
  );
  return Object.fromEntries(entries) as Record<string, string>;
};

const discoverNextContractSubhandle = async ({
  network,
  deploymentHandleSlug,
  currentSubhandle,
  userAgent,
  fetchFn = fetch,
}: {
  network: string;
  deploymentHandleSlug: string;
  currentSubhandle?: string | null;
  userAgent: string;
  fetchFn?: typeof fetch;
}): Promise<string> => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  const currentOrdinal = (() => {
    if (!currentSubhandle) return 0;
    const suffix = `@${HANDLECONTRACT_NAMESPACE}`;
    if (!currentSubhandle.endsWith(suffix) || !currentSubhandle.startsWith(deploymentHandleSlug)) {
      return 0;
    }
    const ordinalText = currentSubhandle.slice(
      deploymentHandleSlug.length,
      currentSubhandle.length - suffix.length
    );
    return /^[0-9]+$/.test(ordinalText) ? Number.parseInt(ordinalText, 10) : 0;
  })();
  const existingOrdinals: number[] = [];
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${deploymentHandleSlug}${ordinal}@${HANDLECONTRACT_NAMESPACE}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) {
      const existingReplacement = existingOrdinals.find((existingOrdinal) => existingOrdinal > currentOrdinal);
      return existingReplacement
        ? `${deploymentHandleSlug}${existingReplacement}@${HANDLECONTRACT_NAMESPACE}`
        : candidate;
    }
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
    existingOrdinals.push(ordinal);
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
  const mintingDataIgnoredPaths = desired.ignoredSettings
    .filter((path) => path.startsWith("settings.minting_data."))
    .map((path) => path.replace(/^settings\.minting_data\./, ""));
  const mintingDataDiffIgnoredPaths = mintingDataIgnoredPaths.map((path) => `values.${path}`);
  const contractEntries = desired.contracts.map((contract) => {
    const expected = expectedContracts.find((item) => item.contractSlug === contract.contractSlug);
    const live = liveContracts.find((item) => item.contractSlug === contract.contractSlug);
    if (!expected || !live) {
      throw new Error(`missing expected/live contract state for ${contract.contractSlug}`);
    }
    const driftType = live.currentScriptHash === expected.expectedScriptHash ? "no_change" : "script_hash_only";
    const replacementSubhandle = nextSubhandles[contract.contractSlug] || null;
    const plannedHandle =
      driftType === "no_change"
        ? live.currentSubhandle || desired.assignedHandles.scripts[contract.contractSlug] || null
        : replacementSubhandle;
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
        value: plannedHandle,
        is_new: driftType !== "no_change",
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: contract.contractSlug,
        expected_script_hash: expected.expectedScriptHash,
        expected_subhandle: plannedHandle,
        assigned_handles: {
          settings: [],
          scripts: plannedHandle ? [plannedHandle] : [],
        },
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
        ignored_paths: [],
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "hal-settings",
        assigned_handles: {
          settings: desired.assignedHandles.settings.halSettings ? [desired.assignedHandles.settings.halSettings] : [],
          scripts: [],
        },
        settings: {
          type: "hal_settings",
          values: expectedSettings.halSettings.values,
          ignored_paths: [],
        },
      },
    },
    {
      contract_slug: "halref-settings",
      drift_type: settingsDriftType(liveSettings.refSpendSettings, expectedSettings.refSpendSettings),
      settings: {
        type: "halref-settings",
        diff_rows: diffRows(liveSettings.refSpendSettings, expectedSettings.refSpendSettings),
        desired_values: expectedSettings.refSpendSettings.values,
        ignored_paths: [],
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "halref-settings",
        assigned_handles: {
          settings: desired.assignedHandles.settings.refSpendSettings ? [desired.assignedHandles.settings.refSpendSettings] : [],
          scripts: [],
        },
        settings: {
          type: "halref-settings",
          values: expectedSettings.refSpendSettings.values,
          ignored_paths: [],
        },
      },
    },
    {
      contract_slug: "halmntmpt-settings",
      drift_type: settingsDriftType(liveSettings.mintingData, expectedSettings.mintingData, mintingDataDiffIgnoredPaths),
      settings: {
        type: "halmntmpt-settings",
        diff_rows: diffRows(liveSettings.mintingData, expectedSettings.mintingData, mintingDataDiffIgnoredPaths),
        desired_values: expectedSettings.mintingData.values,
        ignored_paths: mintingDataIgnoredPaths,
      },
      expected_post_deploy_state: {
        repo: REPO_NAME,
        network: desired.network,
        contract_slug: "halmntmpt-settings",
        assigned_handles: {
          settings: desired.assignedHandles.settings.mintingData ? [desired.assignedHandles.settings.mintingData] : [],
          scripts: [],
        },
        settings: {
          type: "halmntmpt-settings",
          values: expectedSettings.mintingData.values,
          ignored_paths: mintingDataIgnoredPaths,
        },
      },
    },
  ];

  const allEntries = [...contractEntries, ...settingsEntries];
  const planId = crypto.createHash("sha256").update(JSON.stringify({
    network: desired.network,
    build_parameters: desired.buildParameters,
    assigned_handles: desired.assignedHandles,
    ignored_settings: desired.ignoredSettings,
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

const diffRows = (
  current: Record<string, unknown> | null,
  expected: Record<string, unknown>,
  ignoredPaths: string[] = []
) => {
  if (!current) {
    return [{ path: "missing_live_state", current: null, desired: expected }];
  }
  const rows: { path: string; current: unknown; desired: unknown }[] = [];
  collectDiffRows(rows, current, expected);
  return rows.filter((row) => !ignoredPaths.includes(row.path));
};

const settingsDriftType = (
  current: Record<string, unknown> | null,
  expected: Record<string, unknown>,
  ignoredPaths: string[] = []
) => (diffRows(current, expected, ignoredPaths).length > 0 ? "settings_only" : "no_change");

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
