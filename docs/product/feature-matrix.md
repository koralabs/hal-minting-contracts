# Feature Matrix

| Area | Capability | Primary Modules |
| --- | --- | --- |
| Contract Build | Parameterized validator assembly for HAL minting suite | `src/contracts/config.ts`, `src/contracts/validators.ts` |
| Deployment | Deploy payload generation for each contract type | `src/txs/deploy.ts` |
| Script Discovery | Resolve latest deployed script metadata + reference-script UTxOs | `src/utils/contract.ts`, `src/txs/deploy.ts` |
| Settings Fetch | Fetch/decode HAL settings and ref-spend-settings assets | `src/configs/index.ts` |
| Minting Data Fetch | Fetch/decode minting-data asset with dual MPT roots | `src/configs/index.ts`, `src/contracts/data/minting_data.ts` |
| Order Request | Create order UTxOs with per-order amount and cost constraints | `src/txs/order.ts` |
| Order Cancel | Owner-signed order cancellation flow | `src/txs/order.ts` |
| Order Refund | Minter-signed refund flow with owner-payment-credential checks | `src/txs/order.ts` |
| Order Aggregation | Validate/order/aggregate order UTxOs for mint windows | `src/txs/prepareOrders.ts` |
| Whitelist Logic | Decode, apply, and mutate whitelist value state | `src/txs/whitelist.ts`, `src/contracts/data/whitelist.ts` |
| Mint Prepare | Build mint tx with asset proofs + whitelist proofs + root updates | `src/txs/prepareMint.ts` |
| Proof Builder | Build and update MPT proofs for requested asset names | `src/txs/proof.ts` |
| Ref Datum Update | Admin-authorized reference datum replacement path | `src/txs/ref_spend.ts` |
| Royalty NFT | Mint and update royalty NFT datum | `src/txs/royalty.ts` |
| Staking Ops | Build registration cert tx for staking governors | `src/txs/staking.ts` |
| CLI Ops | Interactive deploy/settings/staking and MPT actions | `scripts/run/on-chain.ts`, `scripts/run/mpt.ts` |
