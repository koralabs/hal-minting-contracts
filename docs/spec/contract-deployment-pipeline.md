# Contract Deployment Pipeline Spec

## Repository Scope
This repo owns the desired on-chain deployment state for the H.A.L. minting contracts and their handle-backed settings assets. It is the place where engineers state what should be live on `preview`, `preprod`, and `mainnet`, not the place where they preserve transient live chain references.

The deployment pipeline therefore has two jobs:
- derive the script hashes and settings that should exist from committed repo state,
- compare that desired state to live handle and script state without mutating chain state automatically.

## Canonical Source Of Truth
The committed YAML files under `deploy/` are authoritative for deployment planning:

```text
deploy/preview/hal-minting.yaml
deploy/preprod/hal-minting.yaml
deploy/mainnet/hal-minting.yaml
```

These files define build parameters, static settings, handle assignments, and the set of contracts the repo owns. The interactive configuration modules in `scripts/configs/*.ts` can still be used to generate contract exports or datum CBOR during manual operations, but they are not the canonical desired-state input for CI or drift detection. If those modules diverge from `deploy/*.yaml`, the YAML wins for deployment-review purposes.

## Canonical Slug Rules
This repo follows the shared slug naming rules used by the broader contract deployment system:
- `<app><[ord|mnt|ref|roy]><[mpt]>`
- current slugs are `halmntprx`, `halmntmpt`, `halmnt`, `halord`, `halrefprx`, `halref`, and `halroy`
- `old_script_type` exists only to support live lookups that still use legacy script type names

`contracts[].deployment_handle_slug` must be no more than 10 characters and must not include separators such as `-` or `_` because the final SubHandle format appends an ordinal and the `@handlecontract` namespace.

## Desired State Schema
The parser in `src/deploymentState.ts` enforces `schema_version: 2` and validates the shape of every desired-state file. Stable fields include:
- `schema_version`
- `network`
- `build_parameters.*`
- `settings.hal_settings.*`
- `settings.ref_spend_settings.ref_spend_admin`
- `settings.minting_data.*`
- `assigned_handles.settings.*`
- `assigned_handles.scripts.*`
- `ignored_settings`
- `contracts[].contract_slug`
- `contracts[].script_type`
- `contracts[].deployment_handle_slug`
- `contracts[].build.contract_name`
- `contracts[].build.kind`

The parser also prevents accidental configuration drift by rejecting:
- unsupported networks,
- unsupported script types,
- duplicate contract slugs,
- empty contract arrays,
- mismatches between `contract_slug`, `script_type`, and `deployment_handle_slug`,
- observed-only fields that do not belong in committed state.

## Observed-Only Fields
The following fields are explicitly blocked from desired YAML because they describe live observations rather than intended steady state:
- `current_script_hash`
- `current_settings_utxo_ref`
- `current_subhandle`
- `observed_at`
- `last_deployed_tx_hash`

This matters because the repo should remain stable and reviewable. A planner that wrote live references back into git would create noise and make true intent harder to audit.

## Expected Contract Derivation
`buildExpectedContractStates()` constructs all validator and policy hashes from the desired build parameters by calling `buildContracts()`. This means script drift is never inferred from filenames or assumptions; it is recomputed from the same parameters that actually control the compiled programs:
- `mint_version`
- `admin_verification_key_hash`
- `orders_spend_randomizer`
- `royalty_spend_admin`

Each contract entry maps one `build.contract_name` to exactly one derived script hash. If an unsupported contract name appears, plan generation fails immediately.

## Live State Fetching
The planner reads live state from network-specific handle API endpoints:
- `https://preview.api.handle.me`
- `https://preprod.api.handle.me`
- `https://api.handle.me`

It fetches:
- latest deployed script metadata for each contract,
- the HAL settings handle and datum,
- the ref-spend settings handle and datum,
- the minting-data handle, its datum, and its lovelace-bearing UTxO.

All requests require a `User-Agent`, which is why the workflow passes `KORA_USER_AGENT` into `scripts/generateDeploymentPlan.ts`.

Missing live objects are treated as meaningful drift rather than fatal errors when reasonable. For example, a `404` for a script or settings handle can still produce an approval-ready plan that says the live state is missing.

## Drift Classification
The current planner distinguishes between:
- `no_change`
- `script_hash_only`
- `settings_only`

For contract entries, the current implementation checks whether the live script hash equals the expected one. If not, the entry is marked `script_hash_only` and receives a new or replacement SubHandle plan.

For settings entries, the planner recursively diffs the live handle-backed values against the desired values and marks the entry `settings_only` when rows differ.

## Ignored Settings
`ignored_settings` exists so the planner can intentionally suppress diff noise for fields that are allowed to vary outside a contract rollout. In this repo, the committed YAML currently ignores the minting-data root hashes:
- `settings.minting_data.mpt_root_hash`
- `settings.minting_data.whitelist_mpt_root_hash`

That means the deployment plan still records desired values, but those two fields do not cause settings drift on their own. This is important because minting activity naturally changes those roots.

## SubHandle Allocation Rules
Script hash changes cannot silently reuse the same `@handlecontract` SubHandle unless the hash is unchanged. The planner discovers the next handle by:
1. inspecting the current live handle when present,
2. probing ordinalized candidates such as `halmnt1@handlecontract`,
3. selecting the next free or reusable ordinal in sequence.

This ensures that script identity changes are visible and that handle movement remains deterministic across environments.

## Artifact Contract
`scripts/generateDeploymentPlan.ts` emits exactly three artifacts today:
- `summary.json`
- `summary.md`
- `deployment-plan.json`

Each artifact is written into the caller-provided artifacts directory and annotated with:
- `plan_id`
- `repo`
- `network`
- `tx_artifact_generated: false`
- `artifact_files`

The absence of CBOR artifacts is intentional. The current rollout model for this repo is planning and review, not fully automated submission.

## Artifact Semantics

### `summary.json`
- Machine-readable overview of contract and settings drift.
- Includes script hash comparisons, handle plans, diff rows, and expected post-deploy state.

### `summary.md`
- Human-readable review summary.
- Best suited for PR comments, deployment review threads, or artifact inspection without a JSON parser.

### `deployment-plan.json`
- Normalized post-deploy state object that downstream tooling can consume when a deployment is approved.

## Human Approval Boundary
The planner prepares evidence. It does not sign, submit, or auto-heal. Humans remain responsible for:
- reviewing the drift classification,
- deciding whether the change is intended,
- downloading or generating any wallet-signable artifacts required for the rollout,
- approving submission through the correct wallet boundary.

This is especially important for H.A.L. because a bad rollout can alter policy, redirect settings, or break minting governance across environments.

## Operational Failure Modes
- Desired YAML includes observed-only fields and fails schema validation.
- A contract slug or build name does not map to the supported contract set.
- Live handle state is missing or malformed.
- `KORA_USER_AGENT` is absent, causing handle API requests to violate the ecosystem rule for `*.handle.me`.
- Engineers review `scripts/configs/*.ts` instead of the committed desired YAML and misinterpret what the next rollout should do.

## Expected Workflow
1. Edit `deploy/<network>/hal-minting.yaml` if desired state truly changed.
2. Run the deployment planner locally or through CI.
3. Review `summary.md` and `summary.json`.
4. Confirm whether the change is:
   - a script rotation,
   - a settings-only update,
   - a no-op.
5. Obtain human approval before any wallet-signing or submission step.
6. After rollout, verify that live handles and hashes converge to the repo's desired state.

This workflow keeps the repo honest about the difference between "what is committed," "what is live," and "what has merely been proposed."
