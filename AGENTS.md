# AGENTS.md

## Master AGENTS.md
- [REQUIREMENT] Read the AGENTS.md in this project's parent folder for complete instructions and inter-project references

## Canonical contract and enclave
- Read [`CANONICAL_CONTRACT.md`](./CANONICAL_CONTRACT.md): the behaviour this repo must never violate.
- [`.enclave`](./.enclave) lists exact Aiken/Helios on-chain source and policy self-protection requiring operator review. Test-only sources (including separately identifiable embedded tests), npm/package, JS/TS and builders follow ordinary tests and agent review, not human review merely due to this repo. Read the contract for unchanged signing/settings/irreversible/double-mint authority and the path-only gate limitation. Independent review pending; no merge authorized.
