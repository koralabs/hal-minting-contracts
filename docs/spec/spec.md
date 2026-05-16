# Technical Spec

## Architecture Overview
`hal-minting-contracts` combines three layers:

1. On-chain validator and minting-policy programs in `smart-contract/`.
2. TypeScript codecs and transaction builders in `src/`.
3. Operator tooling, deployment planning, and tests in `scripts/`, `deploy/`, and `tests/`.

The repo is intentionally split this way so that contract validation rules remain close to the Aiken sources while off-chain assembly, drift detection, and testing can evolve without obscuring the underlying chain invariants.

## Repository Modules

### `smart-contract/`
- Contains the Aiken validators and libraries for minting, whitelist, royalty, settings, minting-data, and ref-spend logic.
- Includes contract-level tests under `smart-contract/lib/tests`.
- Serves as the source of truth for on-chain validation behavior.

### `src/contracts/*`
- Loads optimized and unoptimized blueprints.
- Applies parameters to validators.
- Defines TypeScript types for settings, minting-data, orders, whitelist entries, MPT proofs, and royalty data.
- Encodes and decodes datum and redeemer payloads so off-chain code can interact with validators safely.

### `src/txs/*`
- Implements the major transaction-building surfaces:
  - order request,
  - order cancel,
  - order refund,
  - order aggregation,
  - mint preparation,
  - reference datum update,
  - royalty mint/update,
  - staking registration,
  - contract export and deployed-script loading.

### `src/store/*`
- Wraps the Merkle Patricia Forestry trie helpers used to track collection inventory and whitelist allocations.
- Provides functions for initialization, inspection, proof printing, inserting, deleting, and bulk filling.

### `src/deploymentState.ts` and `src/deploymentPlan.ts`
- Define the schema for committed desired-state YAML.
- Derive expected script hashes from build parameters.
- Fetch current live scripts and settings via handle API endpoints.
- Build approval-ready JSON and Markdown artifacts that classify drift.

### `scripts/`
- Provides interactive utilities for MPT operations, contract export, settings CBOR generation, and staking-address registration.
- Includes `generateDeploymentPlan.ts`, the repo-local planner entrypoint used by CI.

### `tests/`
- Combines emulator-backed integration tests with unit tests for deployment planning, desired-state parsing, runtime helpers, and trie-proof utilities.

## Contract Set
The current contract suite consists of seven deployable script surfaces:

| Slug | Contract | Kind | Role |
| --- | --- | --- | --- |
| `halmntprx` | `halmntprx.mint` | minting policy | Policy id for H.A.L. assets |
| `halmnt` | `halmnt.withdraw` | withdrawal validator | Governs mint authorization and royalty mint path |
| `halmntmpt` | `halmntmpt.spend` | spending validator | Holds inventory and whitelist roots |
| `halord` | `halord.spend` | spending validator | Stores user order UTxOs |
| `halrefprx` | `halrefprx.spend` | spending validator | Receives reference-token outputs |
| `halref` | `halref.withdraw` | withdrawal validator | Governs reference datum updates |
| `halroy` | `halroy.spend` | spending validator | Holds the royalty NFT and royalty datum |

`src/contracts/config.ts` is the central assembly point that parameterizes these programs and exposes the derived hashes, addresses, and staking credentials needed by the rest of the repo.

## Runtime Flow

### 1. Load environment and network context
`src/constants/index.ts` loads `.env.<NODE_ENV>.local` and exposes:
- `NETWORK`,
- `BLOCKFROST_API_KEY`,
- `KORA_USER_AGENT`,
- `HANDLE_ME_API_KEY`,
- optional `HANDLE_API_ENDPOINT`.

`NETWORK_HOST` and `HANDLE_API_ENDPOINT` are derived from the requested network so handle lookups target `preview`, `preprod`, or mainnet endpoints correctly.

### 2. Resolve settings and live scripts
Before minting or admin actions, off-chain code fetches:
- the HAL settings handle,
- the ref-spend settings handle,
- the minting-data handle,
- deployed reference script UTxOs.

These fetches bridge the repo's local transaction builders to the live chain state actually governing mint execution.

### 3. Validate or aggregate orders
Order handling starts in `src/txs/order.ts` and `src/txs/prepareOrders.ts`.
- `request` builds order outputs and validates basic bounds.
- `cancel` verifies script source and owner signer expectations.
- `refund` verifies script source, settings authorization, and refund credential alignment.
- `prepareOrders` classifies incoming order UTxOs into valid, invalid, and unpicked buckets, then groups valid orders into mint-sized batches.

### 4. Build mint proofs and outputs
`prepareMintTransaction` in `src/txs/prepareMint.ts` is the core mint-preparation path. It:
- sorts aggregated orders deterministically,
- decodes settings and minting-data,
- compares on-chain roots to the local inventory and whitelist tries,
- consumes asset names from the local inventory trie by changing values to `minted`,
- optionally consumes whitelist entitlements,
- creates minting-data redeemers and replacement datum,
- constructs user outputs for `222` assets and reference outputs for `100` assets.

The function returns a transaction builder plus side data that the caller uses to finalize outputs and later persist the updated trie state.

### 5. Execute governed admin flows
Separate builder modules handle:
- royalty mint and royalty datum update,
- reference datum update,
- staking-address registration,
- contract export and deployed-script retrieval.

This separation prevents admin-only actions from being disguised as part of the user mint flow.

## State Model

### Inventory trie
The inventory trie contains pre-defined H.A.L. asset names as keys. Before mint, values are empty. After mint, values become the `minted` marker. This gives the validator a deterministic way to prove that:
- an asset name existed in the approved inventory,
- the asset had not already been consumed,
- the root hash changes correctly after mint.

### Whitelist trie
The whitelist trie is keyed by destination address and stores a list of whitelist entries, each describing:
- early-access time gap,
- amount entitlement,
- discounted price.

Mint preparation computes which subset of those entries is currently usable based on transaction time and order size, then generates the proof required to update the root.

### Handle-backed settings
Three handle-backed assets matter operationally:
- `hal@handle_settings`,
- `hal_pz@handle_settings`,
- `hal_root@handle_settings`.

These handles carry the settings datum, the ref-spend settings datum, and the minting-data datum respectively. The deployment planner reads them to compare committed desired state against live chain state.

## Critical Invariants
- Only the allowed minter may execute user NFT minting.
- Minting requires both the settings reference input and the minting-data spend.
- Local inventory trie root must equal on-chain `mpt_root_hash` before mint preparation.
- Local whitelist trie root must equal on-chain `whitelist_mpt_root_hash` before mint preparation.
- Orders must come from the deployed orders script and carry decodable inline data.
- Refunds must target the owner's payment credential when the order datum can be decoded.
- Reference outputs must route to the ref-spend proxy path so governed metadata updates remain possible.
- Deployment desired-state YAML must not include observed-only fields such as current UTxO refs or observed timestamps.

## Deployment And Drift Detection
The deployment planner turns desired YAML plus live chain observations into three artifacts:
- `summary.json`,
- `summary.md`,
- `deployment-plan.json`.

The planner does not currently emit transaction CBOR. Instead, it tells reviewers whether each repo-owned contract or settings handle has:
- `no_change`,
- `script_hash_only`,
- `settings_only`.

For script drift, the plan also proposes the next SubHandle allocation under the `@handlecontract` namespace. This is critical because new script hashes must move to a new handle rather than silently reusing the old one.

## Source-Of-Truth Rules
The deployment planner uses `deploy/*.yaml` as the canonical desired state. The interactive config modules in `scripts/configs/*.ts` remain helpful for manual workflows, but they are not what CI uses to determine rollout drift. Engineers should therefore reason about the repo in this order:

1. Desired deployment YAML for what should be live.
2. Live chain and handle state for what is live now.
3. Interactive config scripts for ad hoc operator utilities.

If those sources diverge, the divergence is itself operationally important and should be documented or corrected rather than ignored.

## External Dependencies
- `@helios-lang/*` packages for ledger, UPLC, and tx-building primitives.
- `@aiken-lang/merkle-patricia-forestry` for inventory and whitelist tries.
- Blockfrost for live UTxO access.
- `api.handle.me` and its preview/preprod variants for script and handle-backed datum discovery.
- `@koralabs/kora-labs-common` for shared script-detail types.

## Verification Surfaces

### CI workflows
- `.github/workflows/test.yml` runs lint, Aiken tests, and the TypeScript/Vitest suite.
- `.github/workflows/deployment-plan.yml` runs the repo-local deployment planner through the shared deployment workflow.

### Test types
- Emulator integration tests validate minting, whitelist usage, royalty flows, and ref-datum updates.
- Unit tests validate deployment-state parsing, live-state fetch behavior, drift summarization, handle allocation, and utility logic.

Together these tests make the repo more than a contract dump. They prove that the off-chain assembly and deployment abstractions still match the contract model the repo claims to own.
