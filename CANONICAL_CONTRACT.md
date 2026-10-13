# hal-minting-contracts canonical contract

**Status: proposal (ecosystem-ownership-plan row 5.3). Operator review pending.**

HAL NFT minting contracts (Aiken) and their deployment state. Protected production source is listed in [`.enclave`](./.enclave);
other enforcement references below are not automatically enclave paths.

## Review scope and unchanged authority

Decision 2 clarification (2026-10-13): the human-review enclave is actual Aiken/Helios
on-chain source, listed as exact files in [`.enclave`](./.enclave), plus this contract
and the manifest's self-protection. Test-only sources, npm/package files, JS/TS,
builders, configuration, generated artifacts and workflows follow ordinary automated
tests and independent agent review; their location in a contract repository alone
never requires human approval. Existing unrelated holds remain in force.

Separately identifiable embedded Aiken `test` blocks and test-only helpers are testing
code, not protected on-chain behavior. Test-only edits to those blocks follow ordinary
agent review. Mixed files remain listed for their production definitions: the current
path-only merge gate cannot distinguish such hunks and may still request approval.
This is an enforcement limitation, not expanded human-review policy; no source was
split or changed in this documentation-only proposal.

This narrows code-review scope only. Actual on-chain validator or settings changes
(settings handles, policy roots, `pers*@handle_settings` and handlecontract datums),
anything that could double-mint, and automated burns or other irreversible on-chain
actions retain explicit operator authorization. Routine builder/package/test repairs
are not such actions merely because of their repository or filename. K.O.R.A. may
sign for preview only within existing authorization; preprod and mainnet always need
humans on the multisig. No signing, secret access or spending is authorized here.
Independent review pending; this proposal is not accepted and must not be merged.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root): "Critical Correctness" (addresses 100% correct, never
  double-mint, chain-accurate properties) and "Merging" (double-mint, contract/settings edits and
  automated burns need operator approval).
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2 (contract-repo clarification: enclave = Aiken/Helios on-chain source, not npm/package or testing code) and Phase 5 row 5.3
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
