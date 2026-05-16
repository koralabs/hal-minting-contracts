# HAL Minting Contracts PRD

## Summary
`hal-minting-contracts` provides the on-chain scripts, off-chain transaction builders, deployment-planning logic, and operator tooling required to mint a fixed H.A.L. NFT collection safely. The core product promise is simple: users can request mints for a pre-defined collection, operators can batch those requests efficiently, and the system guarantees that only allowed assets are minted while whitelist and governance rules remain enforceable on-chain.

This repo sits between product policy and chain execution. It does not render storefront UI, but it defines the business rules that every storefront, operator, and deployment workflow must obey.

## Background
The H.A.L. collection contains a pre-defined universe of 10,000 asset names. The system is intentionally designed so that users do not learn the specific asset datum at order-sign time. Instead, users place an order UTxO, and an allowed batcher later consumes those orders and mints the final NFT plus its paired reference token. This avoids a predictable exploit where a user inspects metadata before signing and only authorizes transactions containing especially desirable assets.

The repo also supports whitelist-based early access and discounted minting. That means product requirements are not limited to "mint one NFT"; they also include time-window enforcement, deterministic pricing, controlled metadata evolution, and deployment safety across multiple networks.

## Problem Statement
The minting system must solve all of the following at once:
- preserve a fixed collection of allowable asset names,
- prevent double minting,
- allow users to submit orders without seeing the final metadata datum,
- let trusted operators batch work efficiently,
- support early-access windows for approved wallets,
- manage post-mint reference datum and royalty state through governed flows,
- keep deployment state understandable and reviewable before any production rollout.

If any one of these controls is weak, the collection becomes economically or reputationally unsafe. As a result, the product must prefer deterministic validation and clear operator workflows over convenience shortcuts.

## Users And Actors

### End users
- Want to request one or more H.A.L. mints.
- Care that pricing is correct, orders can be cancelled when needed, and received NFTs match the collection rules.

### Allowed minters / batchers
- Need efficient tools for collecting order UTxOs and producing mint transactions.
- Need chain-accurate proof generation and predictable failure behavior.

### Contract and deployment operators
- Need deterministic contract export, desired-state YAML, and drift reports.
- Need to know which values are safe to change and which changes imply a new script hash or handle migration.

### Governance admins
- Need controlled flows for royalty datum updates, ref-datum updates, and minting-data root management.

## Product Goals
- Guarantee that only pre-defined H.A.L. asset names can be minted.
- Guarantee that an already-consumed asset name cannot be minted again.
- Allow trusted batchers to mint many user orders in a single transaction without compromising correctness.
- Support whitelist windows and discounted pricing in a way that is deterministic and auditable on-chain.
- Keep reference-token and royalty governance separate from end-user minting.
- Make deployment drift visible before any human signs a rollout.

## Non-Goals
- Public storefront or wallet UX.
- General-purpose NFT minting outside the H.A.L. collection model.
- Automatic self-healing deployment bots that bypass human review.
- Hidden retries or silent fallbacks that conceal source-of-truth mismatches.

## Product Principles

### 1. The collection is fixed
The repo is allowed to change implementation, tooling, or deployment packaging, but it must never change the idea that H.A.L. asset names come from a pre-defined inventory controlled through the minting-data trie.

### 2. Batch efficiency must not weaken fairness
Batching exists to prevent users from choosing metadata at sign time and to reduce operational overhead. It is not a license to introduce opaque mint rules. Every discount, order selection, and refund path must remain explainable.

### 3. Operators need explicit state, not folklore
Desired deployment YAML, handle assignments, plan artifacts, and test coverage are all part of the product. Operational ambiguity is a product defect for a contract repo.

### 4. Governance flows must be separate from user mint flows
Royalty updates, reference datum updates, and minting-data administration exist, but they should each have distinct authorization paths instead of piggybacking on user-order behavior.

## Functional Requirements

### Order intake
- Users can create one or more order outputs in a single request transaction.
- Each order specifies a destination address, quantity, and paid lovelace amount.
- Destination addresses must be base addresses rather than validator destinations.
- Order quantity must be positive and bounded by the configured per-order maximum.
- A single transaction must not exceed the repo-defined maximum order-UTxO count.

### Order cancellation and refund
- A user can cancel an unconsumed order with the owner signer path.
- The allowed minter can refund an order through the governed refund path.
- Refund logic must validate the script source and, when the datum decodes cleanly, must send the refund to the same payment credential that created the order.

### Mint preparation
- Operators can fetch candidate order UTxOs from the deployed orders script.
- Invalid orders are separated from mintable ones rather than silently ignored.
- Valid orders are aggregated by destination address and constrained by:
  - max order amount per mint transaction,
  - max grouped transactions per lambda/batch,
  - remaining collection inventory.
- Aggregation must respect whitelist availability and timing rules before a mint builder is constructed.

### Asset integrity and proofs
- Every asset minted to a user must correspond to a pre-filled asset name in the local trie.
- The trie proof for that asset must be included so the on-chain validator can update root state from available to minted.
- Local asset trie and on-chain minting-data root must match before mint construction begins.
- The same match requirement applies to whitelist trie state.

### Whitelist support
- The system stores whitelist entitlements in a dedicated trie keyed by destination address.
- Each whitelist item can encode how early a wallet may mint, how many discounted mints remain, and what discounted price applies.
- When whitelist entitlements are consumed, the repo must update local whitelist trie state and supply the proof required for on-chain validation.

### Mint execution
- The allowed minter is the signer that authorizes user NFT minting.
- Mint execution mints both the user-facing `222` assets and the paired reference `100` assets.
- Reference outputs must be routed to the ref-spend proxy path for governed datum updates.
- User outputs must route minted H.A.L. NFTs to the order destination address.

### Royalty and reference governance
- A governed flow exists to mint the single royalty NFT and lock it at the royalty-spend validator with a royalty datum.
- A separate admin path can replace the royalty datum later.
- A ref-spend admin path can replace the datum attached to a reference token after mint.

### Deployment planning
- The repo must own committed desired state for `preview`, `preprod`, and `mainnet`.
- The planner must compare desired script hashes and settings values to live state and classify drift.
- The resulting artifacts must be readable by reviewers before any wallet signing occurs.

## User And Operator Stories
- As a user, I can place an order for one or more H.A.L. NFTs without needing to know the final metadata datum in advance.
- As a user, I can cancel my own order if it has not yet been consumed.
- As a batcher, I can collect valid orders, group them safely, and produce a mint transaction that includes all required proofs.
- As a batcher, I can distinguish valid, unpicked, and invalid orders so I know what to mint now versus later versus refund.
- As a governance admin, I can update royalty or reference metadata without changing the user mint path.
- As a deployment operator, I can tell whether a planned change will rotate a script SubHandle, update settings only, or do nothing at all.

## Product Constraints
- The repo depends on Cardano script semantics and Helios/Aiken contract packaging.
- Some flows require live handle API and Blockfrost data to assemble or validate transactions.
- Human wallet approval remains part of deployment, even when drift detection and artifact generation are automated.
- Documentation must remain aligned with both the current code and the desired deployment model.

## Quality Requirements

### Correctness
- No asset outside the pre-defined inventory may be minted.
- No already-minted asset may be minted again.
- Reference and royalty flows must not weaken user mint safety.

### Observability
- Deployment plan output must show enough detail for a reviewer to reason about drift and intended post-deploy state.
- Tests must cover both emulator mint flows and deployment-planning logic.

### Operator clarity
- Docs must explain which files are canonical for deployment truth.
- Admin roles and signer expectations must be explicit.
- Invariant failures must be treated as blockers, not operational noise.

## Success Criteria
- End-to-end mint tests pass, including regular minting, whitelist minting, royalty minting, and reference datum updates.
- Unit coverage remains strong across runtime helpers, desired deployment parsing, and deployment plan generation.
- Committed docs make the contract set, deployment state model, and minting lifecycle understandable without reverse-engineering the code.
- The combined documentation in `docs/product` and `docs/spec` is complete enough for operators and reviewers to reason about this repo without relying on tribal knowledge.
