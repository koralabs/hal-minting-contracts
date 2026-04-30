# HAL Minting Architecture Reference

## Overview

The repository is a TypeScript contract-support package built around a compiled Aiken validator set and a Helios-era transaction assembly stack. It has three major responsibilities:

1. produce parameterized validator artifacts and deployment metadata,
2. provide off-chain transaction builders for all supported contract flows,
3. model desired deployment state and compare it to live on-chain state.

The runtime shape is intentionally small. The package exports functions; it is not a long-running daemon. External tooling, tests, or operator scripts call those functions and supply wallets, tries, and environment variables.

## Repository Layout

### `smart-contract/`

This folder contains the on-chain source material:

- `validators/*.ak` for the Aiken validators,
- `plutus.json` and build lock files for compiled output,
- `smart-contract-spec.md` for the older high-level validator narrative.

The code under `src/contracts/` consumes compiled validator blueprints rather than compiling Aiken source on every library call.

### `src/contracts/`

This folder is the bridge between compiled validator artifacts and off-chain callers.

- `validators.ts` locates validators by title in the optimized and unoptimized blueprints, decodes UPLC, applies parameters, and attaches the unoptimized alternative program where available.
- `config.ts` builds the full contract suite for a specific environment and parameter set, then derives policy IDs, validator hashes, script addresses, staking addresses, and registration certificates.
- `data/*` and `types/*` encode and decode datums, redeemers, and proof shapes for settings, orders, minting data, whitelist values, royalties, CIP-68 extras, and MPT proofs.
- `utils.ts` creates parameter data fed into compiled validators.

This layer is the reason the rest of the repo can work with high-level types instead of raw CBOR everywhere.

### `src/txs/`

This is the main off-chain transaction surface. It owns transaction builders and supporting data types for:

- deployment (`deploy.ts`),
- user order flows (`order.ts`),
- order validation and aggregation (`prepareOrders.ts`),
- batch mint assembly (`prepareMint.ts`),
- proof construction (`proof.ts`),
- whitelist accounting (`whitelist.ts`),
- reference datum updates (`ref_spend.ts`),
- royalty mint and update flows (`royalty.ts`),
- staking registration (`staking.ts`).

### `src/configs/`

This folder loads on-chain settings state from the handle API. It resolves the settings, ref-spend settings, and minting-data handles into typed datum plus synthetic `TxInput` objects that can be referenced by transaction builders.

### `src/store/`

This layer wraps the Merkle Patricia Forestry trie used for the fixed asset catalogue and the whitelist database. Higher-level code relies on it to insert, delete, prove, inspect, and print trie entries.

### `src/deploymentState.ts` and `src/deploymentPlan.ts`

These files implement the deployment desired-state model. They parse the committed YAML files, derive expected script hashes from the current contract build, fetch live script and settings state, compute drift, and produce summary artifacts.

### `tests/`

The tests are split between:

- an emulator-backed integration suite for real mint behavior,
- deployment-state and deployment-plan unit tests,
- broad runtime coverage tests for codecs, constants, proof helpers, and environment-dependent branches.

## Contract Build Pipeline

### Parameter Inputs

The contract set is parameterized by a small number of values:

- `mint_version`,
- `admin_verification_key_hash`,
- `orders_spend_randomizer`,
- `royalty_spend_admin`,
- `isMainnet`.

`buildContracts` in `src/contracts/config.ts` takes these values and deterministically derives the full validator set.

### Validator Resolution

`src/contracts/validators.ts` uses `CONTRACT_NAME` titles to find validators in both the optimized and unoptimized blueprints. For validators with parameters, the module applies the parameter datum before returning the `UplcProgramV2`.

This matters for deployment output because the script hash depends on the parameter values. A mint version change, for example, changes the policy hash for the user and reference assets.

### Built Outputs

The built contract object includes:

- the H.A.L. mint policy hash,
- the mint withdrawal validator hash and staking address,
- the minting-data validator hash and script address,
- the orders-spend validator hash and script address,
- the ref-spend-proxy validator hash and script address,
- the ref-spend withdrawal validator hash and staking address,
- the royalty-spend validator hash and script address.

The deployment helper in `src/txs/deploy.ts` then turns a selected contract into:

- optimized CBOR,
- optional unoptimized CBOR,
- optional parameter datum CBOR,
- validator hash,
- optional policy ID,
- optional script address or staking address.

That output is suitable for publishing through the deployment workflow or external tooling.

## Runtime Configuration And External Dependencies

### Environment Variables

`src/constants/index.ts` loads `.env.<NODE_ENV>.local` and exposes:

- `BLOCKFROST_API_KEY`,
- `KORA_USER_AGENT`,
- `HANDLE_ME_API_KEY`,
- optional `HANDLE_API_ENDPOINT`,
- `NETWORK` and `NODE_ENV`.

It also derives `NETWORK_HOST` and the default handle API endpoint. The runtime unit tests intentionally cover these branches because incorrect environment composition breaks all live-state discovery.

### Handle API

The package uses the handle API in two different ways:

- `src/configs/index.ts` fetches live settings and minting-data assets for transaction building,
- `src/deploymentPlan.ts` fetches live settings and script metadata for drift detection.

The deployment planner is network-aware and switches between:

- `https://preview.api.handle.me`,
- `https://preprod.api.handle.me`,
- `https://api.handle.me`.

### Blockfrost And Cardano Clients

Reference script UTxOs are loaded through a Blockfrost-backed Cardano client. `fetchAllDeployedScripts` resolves the latest script metadata through the handle API, then asks the client for the actual reference UTxOs. This is how order cancellation, refunds, minting, and admin flows attach the right scripts without embedding static UTxO references in source control.

## On-Chain State Model

### Stable Settings Assets

Three handle-backed assets anchor live configuration:

- `hal@handle_settings` for global mint settings,
- `hal_pz@handle_settings` for ref-spend settings,
- `hal_root@handle_settings` for current trie roots.

The constants are centralized in `src/constants/index.ts`, and both config loading and deployment planning rely on the same names.

### Order UTxOs

Orders sit at the orders-spend validator address and carry inline datum with:

- owner payment key hash,
- destination address,
- requested amount.

The lovelace in the UTxO is interpreted as the user's payment commitment and validated later during order preparation.

### Main Asset Trie

The main trie maps UTF-8 asset names to values. Available names start with an empty value; consumed names are rewritten to `minted`. The trie root is mirrored on-chain inside the minting-data datum.

### Whitelist Trie

The whitelist trie maps destination-address CBOR to `WhitelistedValue`. A whitelist value is a list of items, each item containing:

- `time_gap`,
- `amount`,
- `price`.

This structure allows the engine to support multi-window whitelist programs rather than a single boolean flag.

### Reference And Royalty Outputs

Minting produces paired user and reference assets:

- `PREFIX_222` tokens go to the user-facing destination address,
- `PREFIX_100` tokens go to the ref-spend proxy path together with inline datum.

The royalty token is separate and uses the special `ROYALTY_ASSET_FULL_NAME`.

## Transaction Builder Surfaces

### `request`

`request` in `src/txs/order.ts` is the user-facing order constructor. It validates address shape and requested amount, decodes settings to find the current orders-spend script hash, and then pays one order output per requested order with inline datum.

Inputs:

- order list,
- decoded settings asset,
- `maxOrderAmountInOneTx`,
- `isMainnet`.

Output:

- a `TxBuilder` containing the new order outputs.

### `cancel`

`cancel` spends one order UTxO using the cancel redeemer. It confirms the order UTxO is actually locked by the current orders-spend script and requires the owner signer encoded in the datum.

### `refund`

`refund` is the operator-controlled escape hatch. It loads `allowed_minter` from the settings datum, confirms the order source script, and enforces that the refund address matches the owner's payment credential when the datum is valid.

### `prepareOrders`

`prepareOrders` is where the raw queue becomes operationally meaningful. The function:

- filters out syntactically invalid or zero-amount orders,
- looks up whitelist state per destination address,
- validates payment against normal and whitelist pricing paths,
- consumes available whitelist allocations in-memory,
- builds grouped order batches constrained by transaction size and remaining supply.

The output is intentionally triaged into mintable, deferred, and invalid sets so the operator can make a clear next decision.

### `aggregateOrderTxInputs`

This helper does the heavier aggregation logic. It sorts and groups orders, tracks remaining whitelist entitlements, and caps each transaction by both `maxOrderAmountInOneTx` and `remainingHals`. The exported `orderToConsecutiveSum7` helper exists because the test suite exercises packing behavior around groups that sum to seven.

### `prepareMintTransaction`

This is the core batch mint assembler. Important steps include:

1. sort aggregated orders by whitelist key so proof ordering is deterministic,
2. decode live settings and minting-data datums,
3. reject the batch if local trie roots differ from on-chain roots,
4. allocate asset proofs by deleting each chosen asset from the trie and reinserting it as `minted`,
5. optionally build whitelist proofs and updated whitelist values,
6. assemble the new minting-data datum with updated roots,
7. build outputs for users, reference assets, and updated minting-data state,
8. attach reference scripts and the mint governor withdrawal.

The return value includes the `TxBuilder` plus the updated trie objects and output summaries, because callers often need both the transaction and the post-transaction local state.

### `rollBackOrdersFromTries`

This helper reverses local trie mutations when a prepared batch is abandoned. It is operationally important because proof generation mutates the in-memory tries before chain submission occurs.

### `update`

`update` in `src/txs/ref_spend.ts` replaces the datum on a reference output. It checks that the reference asset is present, loads the ref-spend settings datum, withdraws from the ref-spend governor, and re-locks the reference token with the new datum.

### `mintRoyalty` And `updateRoyalty`

These two functions implement the royalty lifecycle:

- mint one royalty NFT to the royalty spend script with inline datum,
- later replace that datum while preserving the royalty token.

### `registerStakingAddresses`

This helper builds registration certificates for multiple staking addresses in one transaction. It is operational infrastructure for script governance rather than user minting.

## Deployment Desired-State Model

### YAML Parsing Rules

`parseDesiredDeploymentState` in `src/deploymentState.ts` is intentionally strict. It rejects:

- invalid YAML,
- wrong schema version,
- unknown network,
- unsupported contract slugs or script types,
- missing required objects and arrays,
- observed-only live fields committed into desired-state files,
- mismatches between `contract_slug`, `script_type`, and `deployment_handle_slug`.

The goal is to make the YAML a trustworthy declaration of intent rather than a loose note file.

### Expected State Derivation

`buildExpectedContractStates` recomputes expected script hashes from the current source and desired build parameters. Settings expected state is derived from those hashes plus the YAML values for payment address, mint price, admins, and trie roots.

### Live State Discovery

The planner fetches:

- latest deployed script metadata for each contract,
- live settings handle datums,
- live minting-data roots,
- live handle assignment information.

The code is explicit about tolerating some missing live entries as drift rather than treating them as hard failures. That makes the planner useful even in partially deployed lower environments.

### Drift Output

`buildDeploymentPlan` produces:

- a structured summary JSON,
- human-readable markdown,
- a deterministic plan ID based on the desired and live inputs.

Script entries are classified primarily as `no_change` or `script_hash_only`. Settings entries can additionally represent settings drift while keeping the same script handle.

### Subhandle Allocation

When a script hash changes, the planner does not invent a local ordinal. It probes live handle availability and chooses the next valid `<deploymentHandleSlug><ordinal>@handlecontract` candidate. This keeps handle transitions chain-aware.

## Key Invariants

The implementation depends on a few invariants that should be treated as architectural rules:

- the asset trie is the source of truth for what can be minted,
- local and on-chain trie roots must match before minting,
- whitelist consumption must be deterministic and replayable from data,
- settings handle contents and script hashes must agree,
- reference datum updates and royalty updates are independent governance actions,
- desired deployment state must stay free of volatile live-only fields.

When a change proposal conflicts with one of those rules, the burden is on the change to justify itself. The existing architecture is deliberately shaped around them.
