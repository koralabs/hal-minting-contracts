# HAL Verification And Testing

## Why Verification Matters Here

This repository is not a cosmetic wrapper around a mint button. It packages the rules that prevent duplicate minting, invalid asset names, and broken whitelist accounting. A documentation-ready repo therefore needs a clear explanation of how behavior is verified, not just a list of exported functions.

## Test Layers

### 1. Emulator-Backed Integration Suite

`tests/mint.test.ts` is the main behavior suite. It drives the contract package through realistic transaction flows using the shared emulator setup from `tests/setup.ts`. The scenarios cover the full operational lifecycle, including:

- minting the royalty NFT,
- updating the royalty datum,
- placing standard orders,
- rejecting early whitelist mint attempts that should not yet pass,
- minting standard batches after the public window opens,
- placing whitelist orders and successfully minting discounted batches,
- updating reference datum for an already minted asset,
- rejecting batches that include an asset name not present in the main trie,
- cancel and refund behavior,
- handling invalid order datum,
- larger one-user and multi-user aggregation runs,
- whitelisted runs that span many order UTxOs.

This suite is valuable because it tests the collaboration between order preparation, trie proof generation, settings decoding, mint transaction assembly, and wallet signatures. A unit test that checks one function in isolation cannot replace that.

### 2. Deployment-State Unit Tests

`tests/deploymentState.unit.ts` verifies that the YAML desired-state parser:

- loads all three network fixtures,
- preserves key fields such as assigned settings handles and ignored settings paths,
- rejects observed-only fields like `current_script_hash` when they are accidentally committed into desired-state YAML.

These tests protect the deployment planner from silently accepting ambiguous configuration.

### 3. Deployment-Plan Unit Tests

`tests/deploymentPlan.unit.ts` exercises the planning logic around:

- expected script hash derivation,
- tolerant handling of missing live scripts and handles,
- live settings decoding from handle API payloads,
- drift summary generation for both scripts and settings,
- subhandle ordinal discovery.

This layer is important because deployment planning is now a first-class feature of the repo. If drift detection becomes unreliable, operators lose the fastest way to distinguish code bugs from stale or partial deployment state.

### 4. Runtime Coverage Tests

`tests/runtime.unit.ts` broadens coverage across infrastructure and codec branches that are easy to neglect:

- environment-based constant derivation,
- error conversion helpers,
- MPT proof parsing and failure modes,
- address, credential, staking, and datum codec helpers,
- Blockfrost network parsing and client creation,
- config helper behavior,
- store and proof helper success and error paths.

This file is intentionally wide. Its purpose is not to model one user story, but to keep edge branches and data-shape code exercised.

## What The Integration Suite Proves

The mint integration suite gives evidence for the core repository invariants.

### Supply Integrity

Tests that mint named assets such as `hal-1` through `hal-3`, `hal-101` through `hal-115`, and the larger `hal-201` and `hal-301` ranges demonstrate that the engine can consume pre-defined assets in batches while preserving quantity and routing.

### Rejection Of Unknown Assets

The explicit failure scenario involving `no-hal-12` proves that the mint preparation path is anchored to the trie, not to whatever list of names an operator happens to supply.

### Blind Order Then Reveal

The sequence of user order creation followed later by mint preparation demonstrates the product's hidden-metadata design. The user signs for an order first; the actual asset datum appears only when the batcher executes the mint.

### Stateful Whitelist Consumption

Whitelist-specific scenarios prove both rejection and success cases:

- a too-early mint attempt can fail even when an order exists,
- a later attempt can succeed with whitelist entitlement,
- larger whitelist batches continue to respect amount and UTxO grouping rules.

### Administrative Control Paths

The suite also covers the flows that are easy to forget in product-only docs:

- minting the royalty NFT,
- updating royalty datum,
- updating reference datum,
- operator refunds,
- owner cancellations.

Those tests matter because the administrative paths have different signer requirements from normal user order creation.

## Manual Verification Expectations

Automated tests are necessary but not sufficient for operational changes. When changing minting logic, deployment state handling, or settings decoding, a reviewer should also confirm:

1. the docs indexes still reference every current product and spec page,
2. the deployment YAML remains parseable and free of observed-only fields,
3. environment-specific values still make sense for the target network,
4. any new transaction path clearly states which signer role is required,
5. trie root comparisons still happen before mint execution.

For deployment-related changes, verifying the live environment state is also required because stale handles or incomplete rollouts can mimic code regressions.

## Recommended Commands

The repo provides several verification entry points:

```bash
npm test
npm run test:unit
./test_coverage.sh
```

`npm test` runs the main Vitest suite. `npm run test:unit` isolates the narrower unit-focused configuration. `test_coverage.sh` is the repository guardrail for line and branch coverage and writes the summarized report used by the existing docs.

For documentation-only work, running the full emulator suite is optional under the parent AGENTS guidance. Even then, it is still useful to at least validate that the docs tree is internally linked and that the edited markdown tracks the current code structure.

## Coverage Expectations

The current PRD already calls out two explicit quality goals:

- `tests/mint.test.ts` should continue to pass,
- coverage should remain at or above the repo guardrail reported by `test_coverage.sh`.

When adding new contract behavior, prefer extending the existing scenario suites over adding superficial happy-path assertions. The most valuable tests in this repo are the ones that prove:

- a batch rejects stale trie state,
- a malformed or underpaid order is surfaced correctly,
- a privileged signer is actually required,
- data is routed to the correct script or user address,
- rollback paths restore local trie state after an aborted mint preparation.

## Documentation As Part Of Verification

Because the repository is used operationally, documentation itself is a verification surface. If a code change adds a new signer requirement, alters handle assignment expectations, or changes the deployment summary artifact shape, the docs need to move in the same change. Otherwise the next operator will follow stale instructions against a high-stakes minting system.

That is why this repo should treat docs, tests, and deployment YAML as one verification package instead of three unrelated maintenance chores.
