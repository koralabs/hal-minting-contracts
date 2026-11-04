# hal-minting-contracts canonical contract

I am the on-chain rulebook for HAL: the Aiken validators (mint proxy, minting-data MPT, orders, reference-datum, royalty) plus the TypeScript builders and deployment plan. Once deployed the validators cannot be patched.

1. **A HAL is never minted twice or outside the set.** A mint is valid only if the minting-data root advances exactly by the minted asset names, each proven against the 10,000 predefined names.
2. **Only the allowed minter mints.** Minting and refunds need the signature of a minter listed in the settings datum, and the minting-data UTxO is spent in the same transaction.
3. **The buyer gets the HAL.** The 222 token goes to the order's destination at the price paid; the reference (100) token goes only to the ref-proxy address.
4. **Whitelist timing and price are enforced on chain.** Before `minting_start_time` only whitelisted addresses mint, no earlier than their allowed time and never below the whitelist price.
5. **Orders pay their owner.** An order is cancelled only with its owner's signature, one at a time. A refund goes to the datum owner, is allowed by the minter only, one at a time, and an order with a bad datum is still refundable.
6. **Policy id and proxy hashes are frozen.** `halmntprx` and `halrefprx` never change what they govern; logic moves only by swapping governor scripts in the settings datum.
7. **Reference datum and royalty changes need their admin.** A HAL's reference datum updates only with the ref-spend admin's signature, the royalty token only with the royalty admin.
8. **No validity upper bound is ever required or set.** Validators may read a validity start but never require `invalid_hereafter`, and builders set none on mint, order or refund transactions, so chained transactions stay valid.
9. **`deploy/<network>/hal-minting.yaml` is the desired state.** The plan only compares desired to live state and never mutates the chain by itself.
