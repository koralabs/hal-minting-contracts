# HAL Minting Contracts PRD

## Summary
`hal-minting-contracts` delivers smart-contract packaging and off-chain SDK flows for minting pre-defined H.A.L NFT assets, including order intake, whitelist discount handling, reference-token routing, and royalty metadata control.

## Problem
H.A.L minting needs deterministic controls for:
- Reserving and minting only pre-defined assets.
- Enforcing ordered mint amounts and payment constraints.
- Supporting whitelist-based early-access discounts.
- Updating CIP-68 reference metadata and royalty configuration through authorized flows.

## Users
- Kora Labs operators and batchers executing mint runs.
- Internal tooling that prepares and submits mint/order/refund transactions.
- Contract deployment operators publishing script artifacts and settings datums.

## Goals
- Keep mint eligibility chain-accurate via MPT proofs and root-hash checks.
- Allow users to place/cancel orders while preserving batcher-managed mint execution.
- Integrate whitelist windows and discounted mint logic without breaking deterministic validation.
- Provide deploy, staking, royalty, and ref-update helper APIs for operations.

## Non-Goals
- Public web storefront implementation.
- User wallet UX/UI.
- Generic NFT mint engine not tied to H.A.L contract model.

## Functional Requirements

### Orders
- Build order transactions for one or more `Order` items, bounded by:
  - max order amount per order,
  - max order UTxOs per transaction.
- Support owner cancellation flow.
- Support minter-authorized refund flow with owner-payment-credential validation.
- Fetch order UTxOs from deployed `orders_spend` script.

### Mint Preparation and Execution
- Validate order UTxOs before aggregation.
- Aggregate valid orders into executable mint groups constrained by:
  - `maxOrderAmountInOneTx`,
  - `maxTxsPerLambda`,
  - `remainingHals`.
- Build mint proofs from asset trie and whitelist trie.
- Ensure local MPT and whitelist-MPT roots equal on-chain minting-data roots before tx construction.
- Mint paired `100` reference and `222` user assets and route outputs correctly.

### Whitelist Handling
- Load per-address whitelist value from whitelist trie.
- Apply time-gap and amount/price rules to determine discounted eligibility.
- Update whitelist state after order consumption and preserve updated proofs for on-chain validation.

### Royalty and Reference Datum Management
- Mint the royalty NFT to royalty spend script with royalty datum.
- Update royalty datum with admin-signed transaction.
- Update reference asset datum through ref spend governance flow.

### Deployment and Operations
- Produce deploy payloads for all HAL contracts:
  - mint proxy, mint withdraw, minting data spend, orders spend,
  - ref spend proxy, ref spend withdraw, royalty spend.
- Build settings and ref-spend-settings datum CBOR in CLI.
- Build staking registration tx CBOR for mint + ref spend governors.

## Success Criteria
- Integration suite (`tests/mint.test.ts`) passes.
- Coverage guardrail (`test_coverage.sh`) remains >=90% lines and branches.
- Documentation stays aligned with exported APIs and CLI operational flows.
