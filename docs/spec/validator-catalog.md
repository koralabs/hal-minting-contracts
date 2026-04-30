# Validator Catalog

## Purpose
The H.A.L. minting system is distributed across seven contract surfaces rather than a single validator. That separation is intentional. It keeps policy identity, user orders, mutable reference data, royalty governance, and minting-state tracking from collapsing into one brittle script.

This document summarizes each contract in terms of:
- what it controls,
- what parameters affect its hash,
- what datum or redeemer surfaces matter,
- which invariants it enforces in the broader system.

## Contract Summary Table

| Slug | Contract | Primary job |
| --- | --- | --- |
| `halmntprx` | `halmntprx.mint` | Mints the H.A.L. policy assets and ties minting to the mint governor |
| `halmnt` | `halmnt.withdraw` | Authorizes mint actions and royalty minting via a staking validator path |
| `halmntmpt` | `halmntmpt.spend` | Stores and updates inventory and whitelist root hashes |
| `halord` | `halord.spend` | Holds user order UTxOs until cancellation, refund, or batch execution |
| `halrefprx` | `halrefprx.spend` | Receives reference-token outputs that back governed metadata updates |
| `halref` | `halref.withdraw` | Authorizes reference-datum update flows |
| `halroy` | `halroy.spend` | Stores the royalty NFT and royalty datum |

## `halmntprx.mint`

### Role
This is the policy id for H.A.L. user assets and reference assets. If its parameters change, the policy id changes.

### Parameterization
- `mint_version`

Because the policy hash is part of the collection identity, changes here are high impact and should be treated as collection-level events rather than ordinary deployment updates.

### Datum and redeemer
- datum: none
- redeemer: unconstrained at the outer surface, but effective use is gated by the associated mint governor

### Key rules
- The minting policy expects the HAL settings asset to be present in reference inputs.
- The parameterized version must align with the version stored in the settings record.
- The mint governor withdrawal validator must also execute, which means the policy alone is not enough to mint.

### Operational implication
Engineers must assume that redeploying this script is a breaking identity change. It is not equivalent to rotating a spending validator while keeping the collection policy constant.

## `halmnt.withdraw`

### Role
This withdrawal validator is the mint governor. It authorizes H.A.L. user mints and the royalty mint path without forcing the policy id itself to change when other logic evolves.

### Parameterization
- none

### Redeemers
- `MintNFTs`
- `BurnNFTs`
- `MintRoyaltyNFT`

### Key rules
- `MintNFTs` requires the HAL settings handle in reference inputs.
- `MintNFTs` requires the minting-data UTxO to be spent, ensuring root-hash state changes participate in the same transaction.
- `MintRoyaltyNFT` requires the allowed minter signature from settings.
- `MintRoyaltyNFT` allows minting only one royalty NFT and requires it to be sent to the royalty-spend validator.
- Burn support is reserved but not productized yet.

### Operational implication
This validator is the gatekeeper that turns "a policy exists" into "a mint is allowed now under current settings." If the settings handle or minting-data spend is absent, the mint must fail.

## `halmntmpt.spend`

### Role
This spending validator holds the minting-data asset that tracks both the collection inventory root and the whitelist root. It is the state transition point that prevents double minting and invalid whitelist consumption.

### Parameterization
- `admin_verification_key_hash`

This parameter defines the admin authority that can update root-hash state outside a normal mint path when needed.

### Datum
The datum is treated permissively at the outer type boundary, but operationally it represents `MintingData`:
- `mpt_root_hash`
- `whitelist_mpt_root_hash`

### Redeemers
- `Mint(List<Proofs>)`
- `UpdateMPT`

### Key rules for `Mint`
- HAL settings must be present in reference inputs.
- The allowed minter signature must be present.
- The spending input must carry the minting-data asset.
- Order inputs are aggregated by destination address and checked against the supplied proofs.
- User outputs must match the aggregated order amounts.
- Asset proofs must show that each asset existed in the inventory trie before being flipped to minted.
- If a whitelist proof is provided, the validator verifies that the proof matches the destination address and the discounted allocation being consumed.

### Key rules for `UpdateMPT`
- Admin authority is required.
- The path exists to maintain root-hash state without pretending a user mint occurred.

### Operational implication
This is the most stateful contract in the system. Local trie drift versus on-chain root drift is a hard blocker because the contract assumes the off-chain runtime built proofs against the exact live roots.

## `halord.spend`

### Role
This validator stores user order UTxOs between request time and batch execution.

### Parameterization
- HAL policy id
- optional orders-spend randomizer

The randomizer exists because changing it changes the script hash without changing the logical purpose of the contract.

### Datum
`OrderDatum`:
- `owner_key_hash`
- `destination_address`
- `amount`

### Redeemers
The TypeScript builders expose three meaningful flows:
- cancel order
- refund order
- execute order as part of mint preparation

### Key rules
- Order requests pay lovelace and inline datum to the orders script.
- Cancel requires the order owner signer path.
- Refund requires the governed minter path and must respect the owner's payment credential.
- Execute occurs only in a mint transaction that also satisfies the mint and minting-data validators.

### Operational implication
The orders script is where user intent waits. Any ambiguity in order decoding or payment validation turns into either an invalid order bucket or a refund requirement, not a silent partial mint.

## `halrefprx.spend`

### Role
This validator is the landing zone for reference tokens minted alongside user NFTs.

### Parameterization
- none

### Datum and redeemer
The contract exists primarily as a routing and governance anchor. The corresponding TypeScript flow later retrieves reference UTxOs from this address so a governed update can replace the datum.

### Key rules
- Mint preparation routes every reference token output here rather than directly to a user wallet.
- The validator works together with the ref-spend governor and ref-spend settings handle to ensure metadata changes stay controlled.

### Operational implication
Without this separation, the system would lose a clean way to mutate reference metadata while leaving user NFTs untouched.

## `halref.withdraw`

### Role
This withdrawal validator governs the reference-datum update path.

### Parameterization
- none

### Runtime usage
The TypeScript `update` flow in `src/txs/ref_spend.ts` uses:
- the reference-token UTxO,
- deployed ref-spend scripts,
- the ref-spend settings asset,
- the ref-spend admin signer path.

### Key rules
- A valid reference token for the requested asset must be present.
- Governance is derived from the ref-spend settings record rather than from user ownership.
- The path updates inline datum while preserving the governed reference-token model.

### Operational implication
This keeps metadata correction or post-mint evolution separate from end-user order handling. A user owning the visible NFT does not automatically imply authority to rewrite the reference datum.

## `halroy.spend`

### Role
This validator stores the royalty NFT and its datum so royalty policy remains a governed on-chain object.

### Parameterization
- `royalty_spend_admin`

Changing this parameter changes the validator hash because it changes who can govern the royalty datum.

### Runtime usage
The TypeScript layer exposes:
- `mintRoyalty`
- `updateRoyalty`

The first mints the one royalty NFT through the mint governor path. The second spends the royalty UTxO and replaces the datum using the royalty admin signer.

### Key rules
- Only one royalty NFT is minted.
- The allowed minter is required for the initial mint path.
- The royalty admin is required for updates.
- The royalty NFT must remain at the royalty-spend validator so governed datum replacement stays enforceable.

### Operational implication
Royalty state is explicit and chain-governed. It is not hidden inside off-chain metadata conventions or assumed wallet storage.

## Cross-Contract Invariants
- The mint policy and mint governor must agree on versioned mint authority.
- The mint governor and minting-data validator must participate together for user minting.
- Order execution is only meaningful when coupled with the minting-data and mint governor paths.
- Reference tokens must route through ref-spend governance rather than directly to users.
- Royalty issuance is a governed one-time mint plus governed updates.

## Why The Split Matters
The seven-contract design may look heavier than a minimal NFT mint flow, but it buys clear boundaries:
- collection identity is distinct from mint governance,
- user order escrow is distinct from inventory state,
- metadata governance is distinct from end-user holdings,
- deployment review can reason about each contract independently.

That separation is one of the main reasons the repo can support both safe minting and approval-friendly deployment planning.
