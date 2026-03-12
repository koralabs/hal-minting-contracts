# Contract Deployment Pipeline Spec

## Repository Scope
This repo owns the desired on-chain deployment state for H.A.L. minting contracts and their contract-level settings.

The repo should define what ought to be live on `preview`, `preprod`, and `mainnet`. It should not be treated as the storage location for volatile live references such as current settings UTxO refs.

Canonical slug naming for this repo follows the shared rule in `adahandle-deployments/docs/contract-deployment-pipeline.md`:
- `<app><[ord|mnt|ref|roy]><[mpt]>`
- this repo currently uses `halmntprx`, `halmntmpt`, `halmnt`, `halord`, `halrefprx`, `halref`, and `halroy`
- `old_script_type` is legacy migration-only

## State Model
- Desired state lives in committed YAML files in this repo.
- Observed live state is read from chain UTxOs and deployed script hashes.
- Operational automation config lives outside this repo in orchestration/control-plane repos.
- Volatile fields such as `tx_hash`, `output_index`, and current UTxO refs belong in observed-state artifacts, not committed desired-state YAML.

## Desired State Files
The committed layout is:

```text
deploy/preview/hal-minting.yaml
deploy/preprod/hal-minting.yaml
deploy/mainnet/hal-minting.yaml
```

Each file contains stable desired state only:

```yaml
schema_version: 2
network: preview
build_parameters:
  mint_version: 0
  admin_verification_key_hash: <hex>
  orders_spend_randomizer: ""
  royalty_spend_admin: <hex>
settings:
  hal_settings:
    allowed_minter: <hex>
    hal_nft_price: 30000000
    payment_address: <bech32>
    minting_start_time: 1757631246160
  ref_spend_settings:
    ref_spend_admin: <hex>
  minting_data:
    mpt_root_hash: <hex>
    whitelist_mpt_root_hash: <hex>
assigned_handles:
  settings:
    hal-settings: hal@handle_settings
    halref-settings: hal_pz@handle_settings
    halmntmpt-settings: hal_root@handle_settings
  scripts:
    halmntprx: hal_mnt_prxy@handle_contract
ignored_settings:
  - settings.minting_data.mpt_root_hash
  - settings.minting_data.whitelist_mpt_root_hash
contracts:
  - contract_slug: halmntprx
    script_type: halmntprx
    old_script_type: hal_mint_proxy
    deployment_handle_slug: halmntprx
    build:
      contract_name: halmntprx.mint
      kind: minting_policy
```

Required stable fields:
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

Observed-only fields that must not be committed into desired-state YAML:
- `current_script_hash`
- `current_settings_utxo_ref`
- `current_subhandle`
- `observed_at`
- `last_deployed_tx_hash`

The initial bootstrap job may populate these files from current chain state, but it must strip live-only references before commit.

`contracts[].deployment_handle_slug` values must be 10 characters or fewer and must not contain separators such as `-` or `_`.
`assigned_handles` must record the currently assigned settings and script handles for each network, including `null` where a settings handle is not live yet.

## Drift Detection
Deployment automation should:
- build the contract and derive the expected script hash,
- load desired YAML from this repo,
- read live chain state for the contract settings UTxO,
- classify drift as `script_hash_only`, `settings_only`, or `script_hash_and_settings`.

No deployment artifact should be created when desired and live state already match.

## SubHandle Rules
- A script hash change requires a new SubHandle in the format `<deployment_handle_slug><ordinal>@handlecontract`.
- A settings-only change reuses the current SubHandle and moves it forward with the settings UTxO.
- The next ordinal must be derived from live chain state, not a repo-local counter.

## Artifact Contract
The deployment workflow for this repo currently emits:
- `deployment-plan.json`
- `summary.md`
- `summary.json`

It does not emit `tx-XX.cbor` artifacts yet. Current rollout scope is drift detection plus approval-ready summary generation, with missing or legacy live handles tolerated so partially deployed networks still produce artifacts.

The canonical observed-state artifact remains JSON, but for HAL it is multi-object:
- seven contract script entries (`halmntprx`, `halmnt`, `halmntmpt`, `halord`, `halrefprx`, `halref`, `halroy`)
- three stable settings-handle entries (`hal-settings`, `halref-settings`, `halmntmpt-settings`)

Each contract entry carries the current script hash and current deployment SubHandle. Each settings entry carries the decoded handle-backed desired values without volatile UTxO refs.

## Human Approval Boundary
Automation prepares deployment transactions and summaries.

Humans remain responsible for:
- downloading CBOR artifacts,
- uploading/signing/submitting in Eternl,
- approving the deployment at the wallet boundary.

Post-submit automation should verify that chain state converges to the desired YAML plus the expected SubHandle transition.
