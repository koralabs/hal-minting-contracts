# Operations Model

## Purpose
This repo is not only a library of smart-contract helpers. It is also the operational control surface for how H.A.L. minting is rolled out, governed, and kept safe across `preview`, `preprod`, and `mainnet`. The contracts, desired deployment YAML, interactive scripts, and tests work together to answer four operator questions:

1. What scripts and settings should be live on each network?
2. Which actor is allowed to perform each minting or admin action?
3. What local and on-chain state must match before a mint can proceed?
4. How do operators detect drift before a rollout becomes unsafe?

## Roles And Responsibilities

### End user
- Places an order that pays the required lovelace to the orders script.
- Does not choose the specific H.A.L. asset datum at order-sign time.
- Can cancel their own order while it is still unconsumed.

### Allowed minter / batcher
- Is the only signer allowed to execute the actual mint path.
- Collects order UTxOs, groups them into mintable batches, and signs the final mint transaction.
- Is also the actor allowed to issue scripted refunds when an order is invalid or no longer processable.

### Minting-data admin
- Controls the `admin_verification_key_hash` parameter on the minting-data validator.
- Can update the minting-data root structure without minting a user NFT when operationally required.
- Must never be treated as a substitute for the allowed minter; the role exists for root management, not for bypassing mint validation.

### Ref-spend admin
- Governs reference-token datum updates after mint.
- Uses the ref-spend settings handle plus the ref-spend validator path to authorize metadata replacement.

### Royalty admin
- Controls the royalty datum at the royalty-spend validator.
- Can mint the one royalty NFT and later update the royalty datum when policy or payout configuration changes.

### Deployment operator
- Owns the desired-state YAML files under `deploy/`.
- Runs the deployment planner to compare desired state with current chain state.
- Prepares approval artifacts for human review but does not bypass the wallet approval boundary.

## Canonical Sources Of Truth

### Desired state
The committed YAML files under `deploy/preview`, `deploy/preprod`, and `deploy/mainnet` are the canonical description of what should be live. They define:
- contract build parameters,
- static settings values,
- stable handle assignments,
- the set of supported contracts,
- which minting-data fields are intentionally ignored for drift.

For deployment planning, these files win over everything else in the repo.

### Live state
Live state is fetched from chain and handle API endpoints at plan time. It includes:
- currently published script hashes,
- currently assigned SubHandles,
- handle-backed settings datums,
- handle-backed minting-data roots.

Live state is informational and should never be committed back into desired-state YAML when it contains volatile references such as UTxO ids or observed timestamps.

### Legacy or operator-local config
The interactive CLI modules in `scripts/configs/*.ts` remain useful for ad hoc contract export, datum CBOR generation, and staking-address registration. They are not the authoritative deployment source of truth. If a value in `scripts/configs/*.ts` diverges from `deploy/*.yaml`, the deployment planner follows the YAML because those files are what CI and approval-ready artifacts consume.

## Environment Model

### Preview
- Lowest-risk environment for contract and handle rollout rehearsal.
- May intentionally tolerate partial settings handle coverage while the new deployment system is being adopted.
- Best place to validate desired-state schema changes and planner artifact formatting.

### Preprod
- Dress rehearsal environment for mainnet-intended topology.
- Useful for validating handle allocation, script-hash drift classification, and live settings decoding against a public network.

### Mainnet
- Production environment with real economic consequences.
- Requires the strongest discipline around source-of-truth, signer control, and rollout review.
- Should be treated as approval-gated even when deployment planning is fully automated.

## Operational Flow

### 1. Prepare local state
- Confirm the repo is on the correct branch and the desired YAML for the target network is current.
- Make sure the MPT and whitelist databases reflect the intended mintable inventory and whitelist allocations.
- Verify environment variables such as `BLOCKFROST_API_KEY`, `KORA_USER_AGENT`, and any API endpoint overrides are present for the network being used.

### 2. Plan deployment or minting work
- For deployments, run the planner against a committed desired YAML path.
- For minting, fetch settings, minting-data, deployed scripts, and current order UTxOs.
- In both cases, treat stale local roots or stale handle-backed settings as a blocking condition rather than something to patch around.

### 3. Build artifacts
- Deployment work produces summary and plan artifacts.
- Minting work produces a transaction builder plus user outputs, reference outputs, and updated trie state.
- Settings and ref-spend settings CBOR may be produced from the interactive CLI when operators need a wallet-ready payload.

### 4. Human approval or signer action
- Minting requires the allowed minter signature.
- Royalty and ref-datum updates require their respective admin signatures.
- Deployment remains human-approved at the wallet boundary even when the plan generation is automated.

### 5. Post-action verification
- Confirm that script hashes, settings handles, or minting-data roots match the expected post-action state.
- For minting, verify that user assets and reference assets were routed correctly and that local trie state has moved from available to consumed.

## Readiness Checklist

### Before a mint batch
- Settings datum decodes successfully.
- Minting-data datum decodes successfully.
- Local asset trie root equals on-chain `mpt_root_hash`.
- Local whitelist trie root equals on-chain `whitelist_mpt_root_hash`.
- Orders selected for the batch are valid and within configured amount limits.
- Enough asset names and metadata payloads exist for the batch.
- The allowed minter wallet has collateral and can sign.

### Before a deployment review
- Desired YAML validates under `src/deploymentState.ts`.
- The planner can derive expected hashes from the requested build parameters.
- Handle assignment names fit the repo's slug and ordinal rules.
- Reviewers understand whether the change is script drift, settings drift, or both.

## Failure Modes That Must Be Treated Seriously
- Root-hash mismatch between local tries and on-chain minting-data.
- Orders that encode an invalid destination, invalid amount, or incorrect payment.
- Missing reference script UTxOs for any of the deployed contracts.
- Planner input that includes observed-only fields or invalid handle slugs.
- Manual operator assumptions that use `scripts/configs/*.ts` as deployment truth after the committed YAML has changed.

## Non-Acceptable Workarounds
- Skipping root comparisons to force a mint through.
- Editing desired YAML to mirror accidental live drift without understanding the cause.
- Refunding or cancelling through the wrong signer path.
- Treating preview success as sufficient proof for mainnet if the desired YAML or handle assignments differ.

## Documentation Expectations
Because this repo is both a contract package and an operations repo, docs have to explain more than transaction builders. A useful update should clarify:
- who signs what,
- where the canonical values live,
- how drift is detected,
- which invariants are hard blockers,
- how to tell the difference between an intended rollout and stale operational state.
