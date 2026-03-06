# Contract Deployment Pipeline Spec

## Repository Scope
This repo owns the desired on-chain deployment state for H.A.L. minting contracts and their contract-level settings.

The repo should define what ought to be live on `preview`, `preprod`, and `mainnet`. It should not be treated as the storage location for volatile live references such as current settings UTxO refs.

## State Model
- Desired state lives in committed YAML files in this repo.
- Observed live state is read from chain UTxOs and deployed script hashes.
- Operational automation config lives outside this repo in orchestration/control-plane repos.
- Volatile fields such as `tx_hash`, `output_index`, and current UTxO refs belong in observed-state artifacts, not committed desired-state YAML.

## Desired State Files
The intended layout is:

```text
deploy/<network>/<contract_slug>.yaml
```

Each file should contain stable desired state only:

```yaml
schema_version: 1
network: preview
contract_slug: hal-minting
build:
  target: <repo build target>
  kind: validator
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
settings:
  type: hal_minting_settings
  values:
    # repo-owned datum/settings values only
```

Required stable fields:
- `schema_version`
- `network`
- `contract_slug`
- `build.target`
- `build.kind`
- `subhandle_strategy.namespace`
- `subhandle_strategy.format`
- `settings.type`
- `settings.values`

Observed-only fields that must not be committed into desired-state YAML:
- `current_script_hash`
- `current_settings_utxo_ref`
- `current_subhandle`
- `observed_at`
- `last_deployed_tx_hash`

The initial bootstrap job may populate these files from current chain state, but it must strip live-only references before commit.

## Drift Detection
Deployment automation should:
- build the contract and derive the expected script hash,
- load desired YAML from this repo,
- read live chain state for the contract settings UTxO,
- classify drift as `script_hash_only`, `settings_only`, or `script_hash_and_settings`.

No deployment artifact should be created when desired and live state already match.

## SubHandle Rules
- A script hash change requires a new SubHandle in the format `<contract_slug><ordinal>@handlecontract`.
- A settings-only change reuses the current SubHandle and moves it forward with the settings UTxO.
- The next ordinal must be derived from live chain state, not a repo-local counter.

## Artifact Contract
The deployment workflow for this repo should emit:
- `deployment-plan.json`
- `summary.md`
- `summary.json`
- one or more `tx-XX.cbor` artifacts
- optional observed-state snapshot artifacts for debugging and audit

The canonical observed-state artifact should be JSON and should include:

```json
{
  "schema_version": 1,
  "repo": "hal-minting-contracts",
  "network": "preview",
  "contract_slug": "hal-minting",
  "current_script_hash": "<hash>",
  "current_settings_utxo_ref": "<tx>#<ix>",
  "current_subhandle": "hal-minting1@handlecontract",
  "settings": {
    "type": "hal_minting_settings",
    "values": {}
  },
  "observed_at": "<iso8601>"
}
```

If more than one transaction is required, the plan artifact must encode execution order and dependencies.

## Human Approval Boundary
Automation prepares deployment transactions and summaries.

Humans remain responsible for:
- downloading CBOR artifacts,
- uploading/signing/submitting in Eternl,
- approving the deployment at the wallet boundary.

Post-submit automation should verify that chain state converges to the desired YAML plus the expected SubHandle transition.
