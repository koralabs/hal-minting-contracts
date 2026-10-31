# hal-minting-contracts canonical contract

I am the on-chain rulebook for HAL: the Aiken validators (mint proxy, minting-data MPT, orders, reference-datum, royalty) plus the TypeScript builders and the deployment plan. The validators decide, on chain, what can be minted, who gets it and where order money goes. Once deployed they cannot be patched, so the Aiken source is the only thing I enclave: a change to any path in [`.enclave`](./.enclave) merging into `master` needs operator approval. Builders, tests, config, artifacts and workflows follow ordinary agent review (operator decision 2, contract-repo clarification). Changing which script or datum is live on a network (settings handles, policy roots, `hal@handle_settings`, `hal_pz@handle_settings`, handlecontract datums) is a separate on-chain action that always needs the operator. Source: ecosystem `AGENTS.md` ("Critical Correctness", "Merging"), `smart-contract/smart-contract-spec.md`, `docs/spec/contract-deployment-pipeline.md`.

## Invariants

1. **A HAL can never be minted twice or outside the set.** A mint is valid only if the minting-data root advances exactly by the asset names minted, each proven against the 10,000 predefined names (`halmntmpt`, `halmnt`, `minting_data` validation). A second mint of a name, or a name not in the set, fails on chain.
2. **Only the allowed minter mints.** Minting and refunds need a signature of a minter listed in the settings datum; the minting-data UTxO must be spent in the same transaction.
3. **The buyer gets the HAL.** The user output of a mint pays the 222 token to the order's destination at the price paid; the reference (100) token goes only to the ref-proxy address. A mint with the HAL sent elsewhere fails.
4. **Whitelist timing and price are enforced by the validator.** Before `minting_start_time` only whitelisted addresses mint, no earlier than their allowed time and never below the whitelist price, tracked by the whitelist root.
5. **Orders pay their owner.** An order can be cancelled only with its owner's signature, one at a time; a refund goes to the datum owner (never another address), is allowed by the minter only, one at a time. An order with a bad datum is still refundable.
6. **Policy id and proxy hashes are frozen.** `halmntprx` and `halrefprx` never change what they govern; logic moves only by swapping governor scripts in the settings datum, an operator-approved on-chain change.
7. **Reference datum and royalty changes need their admin.** A HAL's reference datum updates only with the ref-spend admin's signature; the royalty token updates only with the royalty admin.
8. **Chaining stays valid: no validity upper bound is ever required.** The validators may read a validity start (whitelist timing) but must never require an `invalid_hereafter`, and the builders must not set one on mint, order or refund transactions (see ecosystem "HAL minting relies on transaction chaining").
9. **Preview signing only for K.O.R.A.** Preprod and mainnet transactions need humans on the multisig. This repo plans deployments and compares desired to live state; it never mutates chain state automatically, and no key or mnemonic is committed.
10. **`deploy/<network>/hal-minting.yaml` is the desired state.** It is validated by the schema parser; slugs are at most 10 characters without separators.

## Where each is enforced today

- 1-5, 7: Aiken tests in `smart-contract/lib/tests/validations/` (`cannot_mint_with_invalid_user_output`, `cannot_mint_before_whitelisted_time`, `cannot_refund_order_to_other_user`, `cannot_cancel_order_if_not_signed_by_owner`, and others) and `tests/validators.unit.ts`, which runs the real validators on an emulated ledger (HAL to someone else refused, name outside the MPT refused, cancel by non-owner refused).
- 6: no test; held by the deployed hashes and `tests/heliosParity.unit.ts` / `previewMint.unit.ts` (a real preview mint reproduced).
- 8: `previewMint.unit.ts` replays a real chained mint, but **no test fails if a builder adds an upper validity bound**.
- 9: `.github/workflows/deploy.yml` only publishes the npm package; **nothing in code stops signing for preprod or mainnet**, it is policy and the multisig.
- 10: `tests/deploymentState.unit.ts`, `tests/deploymentPlan.unit.ts`, `tests/fixtures/desired-state-invalid.yaml`.

## Boundaries and known limits

- Path-based enclaving cannot tell a test block from a validator in a mixed `.ak` file, so editing an embedded test can still ask for approval.
- `smart-contract/plutus.json`, `src/contracts/*-blueprint.ts` and `deploy/*.yaml` are not enclaved, though they must match the deployed scripts. They are checked by the deployment plan, and a deployed change is a separate operator action.
- Aiken test coverage shows the validators accept and reject the cases listed; it is not a formal proof.

## Refactors needed to enforce this

- A builder test that decodes mint, order and refund transactions and fails if any carries an upper validity bound.
- A test that pins the hashes of `halmntprx` and `halrefprx` to the deployed values per network.
- A CI check that `plutus.json` and the TS blueprints are generated from the enclaved Aiken sources.
