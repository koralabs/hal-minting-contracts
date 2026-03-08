# Technical Spec

## Architecture

### Modules
- `src/contracts/*`
  - Blueprint decoding, parameter application, datum/redeemer codecs, and typed structs.
- `src/txs/*`
  - Transaction assembly for orders, minting, refunds, deploy, proof, whitelist, royalty, and ref spend.
- `src/configs/*`
  - Fetch + decode on-chain settings/minting data via `api.handle.me`.
- `src/store/*`
  - Trie helpers for local asset and whitelist state.
- `scripts/run/*`
  - Interactive operations for MPT state, settings cbor generation, deploy, and staking registration.

### External Integrations
- `api.handle.me` for handle/script metadata and datum retrieval.
- Blockfrost for UTxO access and transaction context.

## Contract Set
- `halmntprx.mint`
- `halmnt.withdraw`
- `halmntmpt.spend`
- `halord.spend`
- `halrefprx.spend`
- `halref.withdraw`
- `halroy.spend`

`deploy` (`src/txs/deploy.ts`) emits script-specific cbor/hash/address payloads and optional parameter datum cbor.

## Transaction Flows

### Order Flows (`src/txs/order.ts`)
- `request`:
  - validates destination/payment constraints,
  - decodes settings to resolve orders script hash,
  - creates order outputs with inline datum.
- `cancel`:
  - verifies order input source script,
  - validates datum owner,
  - spends order with cancel redeemer and owner signer.
- `refund`:
  - validates settings + input source,
  - enforces refunding payment credential when datum decodes,
  - requires allowed minter signer.

### Order Preparation (`src/txs/prepareOrders.ts`)
- Filters invalid order UTxOs.
- Aggregates valid orders by destination and tx limits.
- Applies whitelist availability and time-gap logic.
- Returns:
  - `aggregatedOrdersList`,
  - `unpickedOrderTxInputs`,
  - `invalidOrderTxInputs`.

### Mint Preparation (`src/txs/prepareMint.ts`)
- Validates local asset trie and whitelist trie roots against on-chain minting-data roots.
- Builds per-order asset-name proofs and optional whitelist proofs.
- Updates local trie states and produces updated minting-data datum.
- Assembles tx with:
  - script references,
  - minting_data spend/relock,
  - order spend execution,
  - mint policy tokens,
  - payment/ref/user outputs,
  - mint governor withdraw redeemer.

### Ref and Royalty Admin Flows
- `src/txs/ref_spend.ts`:
  - updates reference token datum through ref-spend governance path.
- `src/txs/royalty.ts`:
  - mints one royalty NFT and updates royalty datum with admin signature.

### Staking Registration
- `registerStakingAddresses` builds one tx containing registration certs for multiple staking addresses.

## Critical Invariants
- Minting asset names must exist in pre-filled trie and transition from available to minted state.
- Both `mpt_root_hash` and `whitelist_mpt_root_hash` must match local trie roots before mint tx creation.
- Refund/cancel paths enforce script source and credential constraints.
- Whitelist discount consumption must remain deterministic under `minting_start_time` gaps.

## Runtime Configuration

| Variable | Purpose |
| --- | --- |
| `BLOCKFROST_API_KEY` | Network-aware UTxO lookups |
| `KORA_USER_AGENT` | Required user-agent for handle API requests |
| `HANDLE_ME_API_KEY` | Handle API authentication |
| `HANDLE_API_ENDPOINT` | Optional API endpoint override |
| `NETWORK` / `NODE_ENV` | Network and env profile selection |

## Testing and Coverage
- Integration suite: `tests/mint.test.ts`.
- Guardrail script: `test_coverage.sh`.
- Coverage report artifact: `test_coverage.report`.
