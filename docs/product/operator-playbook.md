# HAL Minting Operator Playbook

## Purpose

This playbook explains how to operate the H.A.L. minting contracts safely. It is written for the team member who is preparing a mint run, validating a deployment, or cleaning up a broken batch. The repo exposes the building blocks, but the operator still has to sequence them correctly.

## 1. Pre-Run Checklist

Before touching orders or minting, confirm the environment and deployment state.

### Confirm The Network

The repo supports `preview`, `preprod`, and `mainnet`. The deployment YAML under `deploy/<network>/hal-minting.yaml` is the authoritative desired state for that environment. Start by checking:

- which network you are targeting,
- which payment address is expected,
- which mint price and minting start time should be active,
- which handles are expected to exist.

Do not borrow values from another environment. The YAML files already diverge in price, start time, and handle readiness.

### Confirm Reference Scripts And Settings Handles

The minting transaction builders assume the latest deployed reference scripts can be discovered from the handle API. Verify that the latest `halmntprx`, `halmnt`, `halmntmpt`, `halord`, `halrefprx`, `halref`, and `halroy` scripts are live and that the handle-backed settings assets are readable.

For lower environments, a missing handle can be intentional, but it still changes what flows are actually possible. For example, preview currently models `halref-settings` as `null` in desired state, so ref-spend governance should be treated as not fully provisioned there until deployment catches up.

### Confirm Local Trie Inputs

A mint run is only as trustworthy as the local asset trie and whitelist trie used to build proofs. Before preparing a batch:

- load the local H.A.L. asset trie,
- load the local whitelist trie,
- fetch `hal_root@handle_settings`,
- compare both local root hashes against the on-chain datum values.

If the roots do not match, stop. `prepareMintTransaction` will reject the batch anyway, and forcing forward would break the core anti-double-mint invariant.

### Confirm Administrative Keys

Know which actor is required for the action you are about to take:

- `allowed_minter` for mint and refund paths,
- order owner for cancel path,
- ref-spend admin for reference datum updates,
- royalty admin for royalty datum updates,
- minting-data admin for root maintenance operations.

These are not interchangeable roles.

## 2. Order Intake Rules

The public order path is intentionally narrow. When building or reviewing an order transaction, the operator should expect the following validation rules from `src/txs/order.ts`:

- destination must be a base address, not a validator address,
- amount must be greater than zero,
- amount must not exceed the configured per-order limit passed into `request`,
- a single request transaction cannot create more than `MAX_ORDER_UTXOS_IN_ONE_TX` order outputs.

Each order output carries inline datum with:

- owner payment key hash,
- destination address,
- amount.

The value at the output is the user's payment offer. The exact asset names are still unknown at this stage.

## 3. Preparing A Mint Batch

### Fetch Pending Orders

Use `fetchOrderTxInputs` against the deployed `ordersSpend` script details. This gives the current queue of order UTxOs. Do not guess the order address from stale documentation when the deployed script hash is queryable.

### Run Order Preparation

Use `prepareOrders` with:

- the fetched order inputs,
- decoded `settingsV1`,
- the local whitelist trie,
- the intended minting time,
- transaction sizing limits,
- remaining H.A.L. supply.

`prepareOrders` classifies the queue into three buckets:

- `aggregatedOrdersList` for mintable groups,
- `unpickedOrderTxInputs` for valid orders that simply did not fit into the current run,
- `invalidOrderTxInputs` for orders that should not proceed as submitted.

Review that result. A zero-length mint list with non-empty invalid orders is not a tooling failure; it often means the users paid the wrong amount, the whitelist window is not open, or the order datum is malformed.

### Assign Concrete Assets

For each chosen batch, assemble `HalAssetInfo[]` that matches the total amount being minted. Each item needs:

- the UTF-8 asset name,
- the inline datum that should be written to the reference output.

This step is where the blind-order design is enforced. The user requested quantity, not specific pieces; the operator now binds the batch to the next available catalog assets.

### Build The Mint Transaction

Call `prepareMintTransaction` with:

- the aggregated orders,
- the selected assets,
- the live settings input,
- the live minting-data input,
- the local asset trie,
- the local whitelist trie,
- the deployed script reference inputs,
- the intended transaction time.

Expect it to fail when:

- an asset name is absent from the main trie,
- the local main trie root differs from on-chain state,
- the local whitelist trie root differs from on-chain state,
- the supplied asset list does not cover the requested amounts,
- a whitelist proof cannot be built for an order that needs one.

If it succeeds, keep track of the returned updated trie state and any updated whitelist values. Those reflect the post-mint world the chain is about to enforce.

## 4. Submitting Or Aborting A Prepared Batch

### Submission Path

If the batch is going ahead:

1. complete the transaction with the allowed minter wallet,
2. sign it with the allowed minter key,
3. submit it,
4. wait for confirmation,
5. treat the returned trie state as the new local baseline.

The payment wallet should also be reconciled after the mint. The tests explicitly inspect lovelace movement, which is a reminder that operator accounting is part of correctness.

### Abort Path

If the batch was prepared but will not be submitted, call `rollBackOrdersFromTries`. The preparation step already mutated the in-memory trie state while constructing proofs. Failing to roll that state back will make the next preparation attempt look as if assets or whitelist allocations were already consumed.

This is one of the easiest operator mistakes to make because nothing is wrong on-chain yet; only the local working state is dirty.

## 5. Refunds And Cancellations

### When To Cancel

Use `cancel` when the order owner is intentionally reclaiming their order and can sign with the same payment credential encoded in the datum. The cancellation path:

- requires the order UTxO to actually come from the orders script,
- decodes the order datum,
- adds the owner signer,
- spends the order with the cancel redeemer.

The tests show that trying to cancel multiple incompatible orders in one transaction is rejected. Keep cancellations simple and scoped.

### When To Refund

Use `refund` when the operator, acting as allowed minter, needs to return funds for an order that should not proceed. The refund path:

- checks the settings datum for `allowed_minter`,
- requires the order to be from the orders script,
- enforces that the refunding address matches the owner payment credential when the datum decodes,
- still supports recovering orders whose datum is invalid by spending them through the governance path.

Operationally, refunds are the right answer for permanently invalid or unserviceable orders. Unpicked but otherwise valid orders should usually stay queued for a later batch unless product policy says otherwise.

## 6. Whitelist-Specific Operations

Whitelist logic is stateful. A whitelisted address may have several entries with different time gaps, quantities, and prices. When preparing orders:

- only entries whose `time_gap` covers the current early-access distance are available,
- partial usage of a whitelist allocation must be reflected in the updated whitelist value,
- price validation must account for a mix of discounted and normal-price mints.

That means the operator cannot reason about whitelist orders using a simple "whitelisted or not" mental model. The code supports mixed allocations and partial consumption, and the batch preparation step should be treated accordingly.

## 7. Reference Datum Operations

After minting, the `PREFIX_100` reference token lives on the ref-spend path and can be updated through `update` in `src/txs/ref_spend.ts`. Before updating:

- confirm the reference input really contains the expected reference asset,
- load the ref-spend settings asset,
- attach both ref-spend reference scripts,
- add the ref-spend admin signer,
- provide the new inline datum.

Do not treat reference datum replacement as a side effect of minting. It is a separate, permissioned operation.

## 8. Royalty Operations

The royalty lifecycle is also explicit:

- `mintRoyalty` mints the royalty NFT using the allowed minter and sends it to the royalty spend script with a royalty datum,
- `updateRoyalty` replaces the royalty datum using the royalty admin signer.

There should only be one royalty token in the expected path. If a candidate input does not actually contain the royalty asset, the update call should be considered invalid.

## 9. Deployment And Drift Checks

When preparing a release or investigating broken script discovery, use the deployment planner flow rather than manually comparing ad hoc values. The repo now includes:

- YAML desired state per network,
- a parser that rejects invalid or mixed desired/live fields,
- a planner that computes expected script hashes from current build parameters,
- live-state fetchers for scripts and settings handles,
- subhandle discovery for replacement script deployments,
- summary artifacts suitable for human approval.

This matters during incidents. A minting failure may be caused by stale deployment state rather than a logic bug in `prepareMintTransaction`.

## 10. Common Failure Modes

### Local And On-Chain Roots Diverge

Meaning: the local tries are stale, partially rolled back, or built from the wrong data snapshot.

Response: stop minting, rebuild or restore the trie state, and reconcile against `hal_root@handle_settings`.

### Asset Name Not Pre-Defined

Meaning: the operator attempted to mint a name not present in the main trie.

Response: replace the asset assignment set. Do not patch around this; the trie is the supply source of truth.

### Underpaid Or Mispriced Order

Meaning: normal-price or whitelist-price calculations do not match the value in the order UTxO.

Response: classify the order as invalid and refund it, or leave it queued only if product policy explicitly allows later remediation.

### Missing Live Script Or Handle

Meaning: deployment state or handle assignment is incomplete for the environment.

Response: investigate deployment drift first. Do not keep debugging mint logic while reference script discovery is broken.

### Prepared Batch Was Not Submitted

Meaning: the operator built proofs and mutated local trie state but never landed the transaction.

Response: run rollback before any further preparation attempts.

## 11. Documentation Hygiene For Operators

When behavior changes, update the docs in this repo at the same time:

- product docs when operator workflow or product guarantees change,
- spec docs when transaction interfaces, YAML shape, or validator surfaces change,
- the docs indexes whenever a new page is added.

This repo is an operations-facing contract package. If the docs lag the code, the next mint incident will cost more time than the code change saved.
