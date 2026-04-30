# Data Model

## Scope
The H.A.L. minting data model spans more than contract datums. Engineers working in this repo need to reason about:
- on-chain asset naming conventions,
- handle-backed settings records,
- minting-data and whitelist proof payloads,
- order datums and aggregated order state,
- deployment-plan YAML and live-state artifacts.

This document ties those shapes together so changes to one layer can be reviewed against the others.

## Constants And Identifiers

| Symbol | Value | Meaning |
| --- | --- | --- |
| `PREFIX_100` | `000643b0` | Label for reference tokens paired with minted user assets |
| `PREFIX_222` | `000de140` | Label for user-facing H.A.L. NFTs |
| `SETTINGS_HANDLE_NAME` | `hal@handle_settings` | Handle that stores the HAL settings datum |
| `REF_SPEND_SETTINGS_HANDLE_NAME` | `hal_pz@handle_settings` | Handle that stores ref-spend settings |
| `MINTING_DATA_HANDLE_NAME` | `hal_root@handle_settings` | Handle that stores minting-data roots |
| `LEGACY_POLICY_ID` | `f0ff48...fb9a` | Existing handle policy used for settings-bearing assets |
| `MPT_MINTED_VALUE` | `minted` | Marker written back to the asset trie after consumption |
| `ROYALTY_ASSET_FULL_NAME` | `001f4d70526f79616c7479` | Royalty asset name including the CIP-style label |

These values are defined in `src/constants/index.ts` and are used across both TypeScript and validator logic.

## Asset Naming Model

### User NFT assets
User-facing H.A.L. NFTs use:
- policy id: the hash of `halmntprx.mint`,
- asset name: `PREFIX_222 + <utf8-name-hex>`.

### Reference assets
Reference outputs use:
- the same policy id,
- asset name: `PREFIX_100 + <utf8-name-hex>`.

This pairing lets the system issue a user token and a governed reference token for the same logical H.A.L. asset in one mint flow.

### Settings-bearing assets
Settings, ref-spend settings, and minting-data are stored as handle-backed assets under the legacy handle policy. Their names are stable and human-recognizable because operators need to discover them through the handle API as part of deployment planning and live-state inspection.

## Core Contract Types

### Settings
`src/contracts/types/settings.ts` models the wrapper object, while `settings_v1.ts` models the payload that matters operationally.

`Settings` contains:
- `mint_governor: string`
- `mint_version: bigint`
- `data: UplcData`

`SettingsV1` expands `data` into:
- `policy_id`
- `allowed_minter`
- `hal_nft_price`
- `minting_data_script_hash`
- `orders_spend_script_hash`
- `ref_spend_proxy_script_hash`
- `ref_spend_governor`
- `ref_spend_admin`
- `royalty_spend_script_hash`
- `minting_start_time`
- `payment_address`

This split matters because the outer record identifies the current mint governor and version, while the inner payload provides the concrete routing and pricing values used by runtime transaction builders.

### Ref-spend settings
The ref-spend settings record is smaller by design. `RefSpendSettingsV1` contains:
- `policy_id`
- `ref_spend_admin`

The outer wrapper additionally carries `ref_spend_governor`, which ties the settings asset to the governing validator hash.

### Minting data
`MintingData` currently stores:
- `mpt_root_hash`
- `whitelist_mpt_root_hash`

This is the minimal on-chain summary needed to prove:
- which collection inventory state is active,
- which whitelist allocation state is active.

### Orders
`OrderDatum` contains:
- `owner_key_hash`
- `destination_address`
- `amount`

The datum deliberately does not embed final metadata. It only identifies who owns the order, where minted assets should go, and how many assets are requested.

## Proof Types

### Asset-name proof
`AssetNameProof = [asset_hex_name, mpt_proof]`

This proves that a requested asset name existed in the inventory trie before mint and allows the validator to check the root transition as that entry becomes consumed.

### Whitelist proof
`WhitelistProof = [whitelisted_value, mpt_proof]`

This proves the current whitelist allocation for a destination address and allows the contract to verify any consumed discounted entitlement.

### Mint proof bundle
`Proofs = [AssetNameProof[], WhitelistProof | undefined]`

Each aggregated order in a mint transaction carries the asset proofs for that destination and, if needed, the whitelist proof required to justify early or discounted access.

## Whitelist Value Model
Whitelist state is not a single counter. It is a list of entries so the system can express multiple windows or pricing rules for a single address.

`WhitelistedItem` contains:
- `time_gap: number`
- `amount: number`
- `price: bigint`

`WhitelistedValue` is an array of those items.

At mint-preparation time, the runtime:
1. computes the gap between `minting_start_time` and the requested mint time,
2. filters to the entries currently eligible,
3. checks whether the order amount and paid lovelace are consistent with those entries,
4. updates the local whitelist trie if any discounted allocation is consumed.

## Runtime Aggregation Shapes

### Valid order
The order-preparation code promotes decodable, bounded order inputs into `ValidOrder` records that carry:
- original `txInput`,
- destination address,
- amount,
- whether a whitelist proof is required,
- whether the order was already assigned to a batch.

### Aggregated order
An `AggregatedOrder` represents a mint-ready destination-level grouping rather than a raw order UTxO. This is the shape `prepareMintTransaction` expects after sorting and batching.

### Asset info
Mint preparation also relies on `HalAssetInfo`, which pairs:
- `assetUtf8Name`,
- `assetDatum`.

This is how the off-chain runtime ties a chosen inventory name to the final metadata/reference datum written into outputs.

## Deployment YAML Schema
`src/deploymentState.ts` defines the committed desired-state schema. The top-level object contains:
- `schema_version`
- `network`
- `build_parameters`
- `settings`
- `assigned_handles`
- `ignored_settings`
- `contracts`

### Build parameters
These values affect derived script hashes:
- `mint_version`
- `admin_verification_key_hash`
- `orders_spend_randomizer`
- `royalty_spend_admin`

### Settings section
The `settings` block stores stable desired values for:
- HAL settings,
- ref-spend settings,
- minting-data roots.

### Assigned handles
This section records the stable handles the repo expects each network to use.
- `assigned_handles.settings` tracks handle-backed datum assets.
- `assigned_handles.scripts` tracks current script handles or `null` placeholders.

### Ignored settings
`ignored_settings` allows the planner to accept intentional variance for fields that are expected to move outside a code or settings rollout, currently the minting-data roots.

### Contracts
Each contract entry records:
- `contract_slug`
- `script_type`
- `old_script_type`
- `deployment_handle_slug`
- `build.contract_name`
- `build.kind`

The parser intentionally enforces matching slug/script/deployment names because the planner assumes one stable identity per contract.

## Observed Versus Desired State
Some fields are valid only in planner output or live observations and must never be committed into desired YAML:
- `current_script_hash`
- `current_settings_utxo_ref`
- `current_subhandle`
- `observed_at`
- `last_deployed_tx_hash`

This boundary matters because the repo is supposed to express intended steady state, not volatile chain snapshots.

## State Transitions

### Inventory transition
- Before mint: asset key exists with an empty value.
- After mint: the same key is rewritten to `minted`.

### Whitelist transition
- Before mint: address entry contains full remaining whitelist allocations.
- After discount consumption: one or more entries are reduced or removed according to the amount minted and timing used.

### Deployment transition
- Before rollout: desired YAML and live state may differ.
- Planner output: classifies the difference and proposes the post-deploy state.
- After approved deployment: live scripts and handle-backed settings should converge to the desired state described by the repo.

## Why This Model Matters
Every major workflow in the repo depends on the same data model being interpreted consistently:
- validators enforce it on-chain,
- codecs decode and encode it off-chain,
- deployment planning compares it across environments,
- tests assert that the shapes behave correctly under both happy and failure paths.

If a change alters one of these structures without updating the rest, the defect usually appears as either root-hash mismatch, invalid order handling, misrouted outputs, or false-positive deployment drift.
