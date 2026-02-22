# Minting Lifecycle

## 1. User Order Placement
1. Client creates one or more `Order` entries.
2. `request` validates each destination address/amount and global limits.
3. Transaction pays order script with inline order datum and required lovelace.

## 2. Order Intake and Filtering
1. Batcher fetches order UTxOs from orders spend script.
2. `prepareOrders` validates each order input and decodes datum.
3. Invalid or unprocessable orders are split into:
  - invalid (refund path),
  - unpicked (deferred for future runs).

## 3. Whitelist and Time-Window Evaluation
1. Per destination address, whitelist value is loaded from whitelist trie.
2. `checkCanMintOrder` determines whether whitelist proof is required and whether amount/price constraints pass.
3. Whitelist entries are updated as discounted allocations are consumed.

## 4. Mint Preparation
1. Deployed scripts + settings + minting data are loaded.
2. Local DB root and local whitelist DB root must match on-chain roots.
3. Asset proofs and optional whitelist proofs are generated.
4. New minting-data datum is prepared with updated roots.
5. Tx builder is populated with references, spends, withdrawals, minting values, user outputs, and reference outputs.

## 5. Mint Execution
1. Batcher signs/submits prepared mint tx.
2. Minted assets include:
  - `PREFIX_222` user NFTs.
  - `PREFIX_100` reference NFTs.
3. Reference outputs are routed to ref-spend-proxy address for metadata operations.

## 6. Post-Mint Admin Paths
- Royalty token mint/update for royalty script datum.
- Ref datum update path for minted reference NFTs.
- Refund path for invalid/expired orders.
