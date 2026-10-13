# hal-minting-contracts canonical contract

**Status: proposal (ecosystem-ownership-plan row 5.3). Operator review pending.**

HAL NFT minting contracts (Aiken) and their deployment state. The code that holds the rules below is listed in [`.enclave`](./.enclave);
K.O.R.A.'s `merge_pr` asks the operator before a change to it merges into `master`.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root): "Critical Correctness" (addresses 100% correct, never
  double-mint, chain-accurate properties) and "Merging" (double-mint, contract/settings edits and
  automated burns need operator approval).
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2 (enclave = key/security material,
  prompt files, and the files that define, support or enforce this contract) and Phase 5 row 5.3
  ("every remaining repo, even if the enclave is empty; each AGENTS.md points at both").
- kora-bot `v3/docs/tool-surface.md` (`merge_pr`): cards enclave paths merged into
  `master`/`main`/`mainnet`/`preprod`, reading a root `.enclave`.
- Ecosystem `AGENTS.md` "HAL minting relies on transaction chaining".

## Must never be violated

1. **Never double-mint a HAL.** A mint is valid only if the minting-data MPT root advances by exactly the minted assets (`halmntmpt`).
2. **Policy id and proxy hashes are frozen** (`halmntprx`, `halrefprx`); logic moves by swapping governors in settings.
3. **Chained mints are valid**: no validity interval (TTL) is required or added on mint, order or refund txs.
4. **Orders pay out to their owner**; refunds can't be redirected (`halord`).
5. **Signing:** K.O.R.A. may sign preview only; preprod and mainnet always need humans on the multisig.

## Where it is enforced today

| # | Code |
|---|---|
| 1 | `smart-contract/validators/halmntmpt.ak`, `halmnt.ak` |
| 2 | `halmntprx.ak`, `halrefprx.ak` |
| 3 | `src/txs/` (prose rule) |
| 4 | `halord.ak` |
| 5 | `deploy/<network>/hal-minting.yaml`, `.github/workflows/deploy.yml` |

## Refactor needed for enforcement

- Rule 3 has no test: a builder that adds `invalid_hereafter` should fail one.
