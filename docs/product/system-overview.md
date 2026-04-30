# HAL Minting System Overview

## Purpose

`hal-minting-contracts` is the contract and transaction-building layer for the H.A.L. NFT drop. The repository does not run the public storefront and it does not own an always-on batch service. Its job is narrower and more critical:

- define the on-chain validator set used by the H.A.L. minting flow,
- expose typed off-chain helpers that assemble transactions against those validators,
- encode and decode the datum and redeemer payloads required by the contracts,
- keep desired deployment state for `preview`, `preprod`, and `mainnet` under version control.

The product problem is not just "mint NFTs." H.A.L. minting is designed around a fixed catalogue of pre-authored assets, hidden metadata during order placement, whitelist-based early access, and administrative control over reference metadata plus royalties. That combination explains why the repo contains seven validators, two Merkle Patricia Forestry tries, several handle-backed settings assets, and both product docs and deployment YAML.

## What The System Guarantees

At the product level, the system is trying to preserve a small set of non-negotiable promises:

1. Only pre-defined H.A.L. asset names can be minted.
2. A given H.A.L. asset name can only transition from available to minted once.
3. End users cannot inspect the final NFT datum at order-sign time and then cherry-pick their favorite piece.
4. Early-access buyers can receive discounted or time-gated mint rights only if they are present in the whitelist trie.
5. Operators can update reference datum and royalty datum through explicit administrative flows instead of ad hoc wallet actions.
6. Deployment intent is committed in-repo so script hash and settings drift can be reviewed before chain changes happen.

Those guarantees show up repeatedly across the codebase. `src/txs/prepareMint.ts` refuses to build a mint transaction when the local trie roots do not match the on-chain minting-data datum. `src/txs/prepareOrders.ts` rejects order groups whose payment, whitelist eligibility, or sizing rules do not add up. `src/deploymentState.ts` rejects desired-state YAML that mixes stable desired fields with observed-only live deployment fields.

## Product Scope

This repo owns the contract-facing part of the H.A.L. minting product:

- order request, cancel, and refund transaction builders,
- batch mint transaction preparation,
- whitelist accounting logic,
- reference datum update flow,
- royalty NFT mint and update flow,
- staking registration helper for script governors,
- contract deployment payload generation,
- deployment drift planning against live handle/script state.

This repo does not own:

- wallet UX,
- checkout or portal UI,
- public API service implementation,
- operator scheduling infrastructure,
- storage of the authoritative asset art files or off-chain metadata authoring workflow.

That separation matters for documentation readiness. Product docs here should explain the contract-owned behavior and the operator expectations around it, without pretending the repo is the full storefront.

## Actors And Responsibilities

### End User

The public user submits one or more order requests. In code, those requests become `Order` objects consumed by `request` in `src/txs/order.ts`. The user chooses a destination address, requested amount, and payment amount. The user does not choose the specific H.A.L. asset names. That is intentional: the order datum stores ownership and amount, not the eventual CIP-68 metadata payload.

### Allowed Minter / Batcher

The batcher is the operational actor that turns accumulated orders into real mints. The batcher is represented by `allowed_minter` in the settings datum. This actor:

- reads deployed scripts and settings,
- loads the live minting-data asset,
- selects valid order UTxOs,
- applies whitelist and payment rules,
- assigns actual asset names and datums,
- signs and submits mint transactions,
- executes refund flows for orders that can never be processed as-is.

From a product perspective, the batcher is the trust boundary that preserves metadata secrecy until the mint happens.

### Minting Data Admin

The minting-data validator is parameterized with `admin_verification_key_hash`. This admin can update trie roots without minting actual H.A.L. assets. That authority is intended for controlled maintenance of the asset trie and whitelist trie, not for bypassing supply rules. The docs should treat this as a privileged repair or migration capability.

### Ref Spend Admin

Reference datum updates are governed separately through the ref-spend settings datum. This actor is responsible for changing inline datums on the CIP-68 reference outputs after minting. The code path lives in `src/txs/ref_spend.ts`.

### Royalty Admin

The royalty path is split across two permissions. Minting the royalty NFT still requires the allowed minter through the mint withdrawal validator, while updating the royalty datum later uses the `royaltySpendAdmin` signer supplied to `updateRoyalty`.

### Deployment Operator

The deployment operator maintains the desired state YAML under `deploy/`, reviews planner artifacts, and makes sure each environment has the intended script hashes, handle assignments, and settings values. This actor is product-relevant because a stale handle or mismatched script hash can prevent every other flow from succeeding.

## Core Product Surfaces

### 1. Order Intake

Orders are posted to the `halord.spend` script with an inline order datum. The order datum carries the owner payment credential, destination address, and amount. The transaction value carries the lovelace the user is offering for the mint. The order request path enforces:

- base addresses only,
- positive amounts,
- per-order max size,
- transaction-wide limit on how many order UTxOs can be created at once.

### 2. Batch Minting

Mint execution is always a second-stage process. Operators gather pending orders, decide which orders are currently valid, allocate concrete asset names, and then call `prepareMintTransaction`. The resulting transaction mints both:

- `PREFIX_222` user-facing NFTs, and
- `PREFIX_100` reference NFTs that are parked at the ref-spend proxy address.

The batch mint is where the pre-defined asset catalogue and whitelist proofs are consumed.

### 3. Whitelist Access

Whitelist state is stored in a separate trie keyed by destination address CBOR. A whitelist entry can encode multiple windows with different `time_gap`, `amount`, and `price` values. Product-wise, that means the same address can have several discount tiers or access windows, and the minting engine can consume those tiers incrementally instead of using a simple boolean allowlist.

### 4. Reference Metadata Administration

The project uses CIP-68 style split assets: the user token and the reference token are minted together, and the reference token is routed to the proxy/governance path for later datum updates. This lets Kora Labs keep the mint request blind while still landing rich metadata after the mint.

### 5. Royalty Administration

A single royalty NFT can be minted to the royalty spend script with a royalty datum. That datum can later be replaced without redeploying the whole minting stack. Product-wise, the royalty path is an administrative control plane layered next to, not inside, the main user order flow.

### 6. Deployment State Management

The repo now treats deployment intent as a first-class product surface. Each network YAML captures the expected build parameters, settings values, assigned handles, and contract targets. Operators can compare that desired state against live chain data before deciding whether a deployment is actually needed.

## End-To-End Lifecycle

### Catalogue Preparation

Before a mint window opens, operators need two local data stores ready:

- a primary trie containing the fixed H.A.L. asset names, and
- a whitelist trie containing early-access entitlements.

The main trie starts with all pre-defined names mapped to an empty value. Minting flips those names to `minted`. The whitelist trie starts with address keys and structured whitelist values that describe how much discount access each address has and how early it can mint.

### Settings Publication

The contract set depends on three handle-backed assets:

- `hal@handle_settings`,
- `hal_pz@handle_settings`,
- `hal_root@handle_settings`.

Those assets anchor the global settings, ref-spend settings, and minting-data roots respectively. In addition, the latest deployed reference scripts must be discoverable through the handle API. If those references are missing or stale, the product is not operational even if the source tree builds cleanly.

### Order Collection

Users submit orders in advance of actual minting. This separates the user approval moment from the asset selection moment. The result is a queue of order UTxOs sitting at the order validator address, each with a destination address, an amount, and attached lovelace.

### Eligibility Filtering

The batcher then runs `prepareOrders`, which does three things at once:

- validates that order datums decode and contain meaningful amounts,
- applies pricing rules against either the normal price or any available whitelist discounts,
- groups compatible orders into mintable batches constrained by remaining supply and per-transaction limits.

Orders that fail those checks are not silently ignored. They are surfaced as invalid or unpicked so the operator can decide whether to refund them now or hold them for a later run.

### Mint Preparation

For each chosen batch, the operator assigns concrete asset names and reference datums. `prepareMintTransaction` then:

- confirms the local trie roots still match the on-chain minting-data datum,
- builds asset inclusion proofs,
- optionally builds whitelist proofs,
- updates the local trie state to reflect consumed supply,
- assembles user outputs, reference outputs, and the new minting-data output,
- attaches the required reference scripts and governor withdrawal.

The transaction is only valid if the operator's local view of remaining supply exactly matches the chain-backed root hashes.

### Mint Submission

The allowed minter signs and submits the prepared transaction. After confirmation:

- the user receives the `222` assets,
- the reference outputs land at the ref-spend proxy address,
- the minting-data datum now points at the updated asset and whitelist roots.

### Post-Mint Administration

If metadata or royalty information needs to change, those are separate transactions. This design keeps the user mint path focused while leaving governance hooks available for later operational work.

## Environment Model

The repo carries desired state for `preview`, `preprod`, and `mainnet`. The environment files already show meaningful differences:

- different payment addresses,
- different mint prices,
- different minting start times,
- partial handle assignment in lower environments where a handle may not exist yet.

That last point is important. Lower environments are allowed to be incomplete while the deployment planner still produces useful drift artifacts. Documentation should treat this as an intentional staging characteristic, not automatically as a defect.

## Product Risks To Watch

### Root Mismatch

If a local trie has diverged from the on-chain minting-data datum, minting must stop. Continuing would risk double-minting or minting undeclared assets.

### Incorrect Payment Handling

Whitelist pricing is not just a discount lookup; it is stateful consumption. A stale or incorrectly updated whitelist value can make an order appear underpaid or over-entitled.

### Stale Deployment References

The transaction builders expect reference script discovery through the API and settings handles. If deployment state is stale, every higher-level product flow can fail even though the contract logic itself is correct.

### Administrative Drift

The ref-spend admin, royalty admin, allowed minter, and minting-data admin are distinct powers. Product documentation needs to keep those roles separate so operational playbooks do not blur who is allowed to do what.

## Success Looks Like

The H.A.L. minting product is operating correctly when:

- order UTxOs are accepted only when they meet sizing and payment constraints,
- batch minting consumes only pre-defined assets,
- whitelist discounts are applied deterministically,
- users receive the correct number of NFTs without choosing exact pieces at request time,
- reference and royalty updates remain explicit administrative actions,
- deployment YAML and live chain state stay aligned enough for drift detection to stay trustworthy.

That is the product story this repository needs to preserve.
