# This is H.A.L. Minting Engine Specification

## 1. Overview

- H.A.L. minting engine allows users to mint NFT amongst pre-defined 10,000 NFTs. We use [Merkle Patricia Forestry](https://github.com/aiken-lang/merkle-patricia-forestry) to check that no asset which is not pre-defined is minted and no same asset is minted.

- H.A.L. minting engine has whitelisted-users who can access minting earlier than others. We use [Merkle Patricia Forestry](https://github.com/aiken-lang/merkle-patricia-forestry) to guarantee that no one can access minting earlier unless whitelisted.

- H.A.L. minting engine uses batcher to collect orders from users and mint several NFTs in a single transaction. So users won't know anything about NFT's datum when they request an order. Batcher is white-listed wallet (in `Settings`) and it's the only one who can mint NFTs.

- H.A.L. NFTs have royalty enabled following [CIP 102](https://cips.cardano.org/cip/CIP-0102)

## 2. Specification

### 2.1 Actors

- User: An entity who wants to mint NFTs. The only thing user has to do is to request an order. (which will creates an `Order UTxO` with `Order Datum`)

- Batcher: An entity who collects all orders and mint NFTs. He must be white-listed in `Settings`.

- Admin: An entity who can update `MPF` `root_hash`. The only requirement is NOT to mint any assets. (He is parameterized in the smart contract)

- Kora Lab Admin: An entity who can update `Settings`. (He has `Settings` NFT in his wallet)

### 2.2 Tokens

- H.A.L. NFT: Main NFT for H.A.L. project. Users will receive this NFT when their orders are processed.

  - Policy Id: `mint_proxy` minting policy

  - Asset Name: Among pre-defined 10,000 assets names

- Royalty NFT: Royalty NFT for all H.A.L. NFTs. See [CIP 102](https://cips.cardano.org/cip/CIP-0102)

- Settings NFT: This is Global `Settings` NFT. The global settings is saved in the form of datum attached to this token in `Kora Lab Admin`'s wallet.

  - Policy Id: `"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"` Legacy Ada Handle's policy id (Defined in `hal_nft_mint/settings.ak`)

  - Asset Name: `"hal@handle_settings"` (Defined in `hal_nft_mint/settings.ak`)

- Ref Settings NFT: This is `Ref Spend Settings` NFT. The settings related to `ref_spend_proxy` and `ref_spend` validator, which is saved in the form of datum attached to this token in `Kora Lab Admin`'s wallet.

  - Policy Id: `"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"` Legacy Ada Handle's policy id (Defined in `ref_spend/settings.ak`)

  - Asset Name: `"hal_pz@handle_settings"` (Defined in `ref_spend/settings.ak`)

- Minting Data NFT: This is NFT which holds Merkle Patricia Forestry's root hashes in the form of datum in `minting_data` spending validator. This root hash is updated every time NFT is minted.

  - Policy Id: `"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"` Legacy Ada Handle's policy id (Defined in `hal_nft_mint/minting_data.ak`)

  - Asset Name: `"hal_root@handle_settings"` (Defined in `hal_nft_mint/minting_data.ak`)

### 2.3 Smart Contracts

H.A.L. minting engine works by the combination of several smart contracts.

- `mint_proxy` minting policy

- `mint` withdrawal validator

- `minting_data` spending validator

- `orders_spend` spending validator

- `ref_spend_proxy` spending validator

- `ref_spend` withdrawal validator

- `royalty_spend` spending validator

### 2.4 Data Structures

We use two [MPF - Merkle Patricia Forestry](https://github.com/aiken-lang/merkle-patricia-forestry).

#### MPF

This is a main `MPF` which determines H.A.L. NFTs' name. We initiaize this `MPF` with pre-defined 10,000 H.A.L. NFTs' asset names with value of empty string. (`""`)

`Key`: H.A.L. NFTs name (without asset name label)

`Value`: Initially empty string (`""`) and when that asset is minted becomes `"minted"`.

#### Whitelist MPF

This is a whitelist `MPF` which determines who can mint assets how many hours early. (as whitelisted) We initialize this `MPF` with chose whitelisted users (by taking snapshot at certain point) and their validity.

`Key`: Whitelisted Address (Destination Address) CBOR Hex

`Value`: CBOR Hex of `WhitelistedValue`.

## 3. Smart Contracts Detail

### 3.1 `mint_proxy` minting policy

This is minting policy which mints H.A.L. NFTs.

#### 3.1.1 Parameter

- _version_: The minting policy's version. This is used to indicate that the H.A.L. NFT's version.

  > NOTE: If this version is changed, H.A.L. NFT's policy id will change

#### 3.1.2 Datum

None (minting policy)

#### 3.1.3 Redeemer

Anything

#### 3.1.4 Validation

- must attach `Settings` NFT in reference inputs.

- _version_ in Parameter must be greater than or equal to 0 and must have same value as `Settings.version`.

- validate that `mint_governor` withdrawal validator (`mint` withdrawal validator) is executed.

### 3.2 `mint` withdrawal validator

This is withdrawal validator which must be executed in order to mint (or burn) H.A.L. NFTs. This is used not to change H.A.L. NFT's policy id whenever we update minting engine's logic.

#### 3.2.1 Parameter

None

#### 3.2.2 Datum

None (withdrawal validator)

#### 3.2.3 Redeemer

- `MintNFTs`

- `BurnNFTs`

- `MintRoyaltyNFT`

#### 3.2.4 Validation

- `MintNFTs`: called when minting engine to mints H.A.L. NFTs.

  - must attach `Settings` in reference inputs.

  - must spend `minting_data` UTxO. (with `Minting Data NFT`)

  - check that `minting_data` UTxO is from `minting_data_script_hash` from `Settings`.

- `BurnNFTs`: called when minting engine tries to burn H.A.L. NFTs.

  - Burning is not supported yet.

- `MintRoyaltyNFT`: called when an admin mints royalty NFT.

  - must attach `Settings` in reference inputs.

  - must be signed by `allowed_minter` from `Settings`.

  - must mint only one Royalty NFT. See [CIP 102](https://cips.cardano.org/cip/CIP-0102)

    - Token Name: "Royalty"

    - Asset Name Label: 500

  - Royalty NFT must be sent to `royalty_spend` spending validator.

### 3.3 `minting_data` spending validator

This is spending validator where `Minting Data NFT` is saved with `MPF` `root_hash` and `Whitelist MPF` `root_hash`.

`MPF` `root_hash` holds the information of 10,000 pre-defined asset names and their minting status. (which one is minted or not)

`Whitelist MPT` `root_hash` holds the information of whitelist users. See [whitelist.ak](https://github.com/koralabs/hal-minting-contracts/blob/master/smart-contract/lib/hal_nft_mint/whitelist.ak)

- `time_gap`: How earlier they can access minting than others.

- `amount`: How many they can mint in whitelist period.

- `price`: The discounted price they can mint H.A.L.NFT with.

#### 3.3.1 Parameter

- _admin_verification_key_hash_: This is wallet's public key hash. This is `Admin`'s wallet and is used to update `MPF` `root_hash` without actual minting H.A.L. NFTs.

#### 3.3.2 Datum

Anything (But that is actually `MintingData` type, we use `Data` type just for the case when we accidentally send `Minting Data NFT` with invalid datum)

#### 3.3.3 Redeemer

- `Mint(List<Proofs>)`

- `UpdateMPT`

```rust
// asset name hex format without asset name label
// mpt.Proof is inclusion proof of key as asset name, value as ""
pub type AssetNameProof =
  (AssetName, mpt.Proof)

// whitelisted item
// time_gap: Gap between the time of minting and the time of whitelisting in milliseconds
// amount: Amount of H.A.L. NFTs that address can mint as whitelisted
// price: Discounted price of H.A.L. NFTs that address can mint as whitelisted
pub type WhitelistedItem {
  time_gap: Int,
  amount: Int,
  price: Int,
}

// whitelisted value
// using corresponding whitelisted key (destination address)
pub type WhitelistedValue =
  List<WhitelistedItem>

// whitelist proof
pub type WhitelistProof =
  (WhitelistedValue, mpt.Proof)

// asset name proofs and whitelist proof (which is optional)
pub type Proofs =
  (List<AssetNameProof>, Option<WhitelistProof>)
```

#### 3.3.4 Validation

- `Mint(List<Proofs>)`: called when minting engine mints H.A.L. NFTs.

  - must attach `Settings` NFT in reference inputs.

  - must be signed by `allowed_minter` from `Settings`.

  - spending_input must UTxO with `Minting Data NFT`.

  - for Order Tx Inputs (UTxOs from `Settings.orders_spend_script_hash`), aggregate orders by destination address. (amount will be summed for the same destination addresses and these orders are sorted by address lexicographically)

    This will give us the list of `[ Address: Destination of NFTs, amount: amount of NFTs to mint ]`

    And we also get `total_paid_lovalce` as sum of lovelace from all Order UTxOs which will be used to check that an user has paid correctly.

  - for each item from `AggregatedOrders`; `destination_address` and `amount`

    - there must be corresponding user output. (with aggregated amount of H.A.L. NFTs)

      - for H.A.L. tokens, there must be only aggregated amount of User Assets. Asset Names must be same as the ones from `List<AssetNameProof>`.

    - must have corresponding `asset_name_proofs` (`List<AssetNameProof>`) to update `MPF` `root_hash`.

      > They are inclusion Proofs of asset hex names (as key). We update value from empty string to `minted`

    - if `whitelist_proof_opt` is `Some`, we check how many NFTs we can mint as whitelisted for this aggregated order and update `Whitelist MPF` `root_hash` with given proof.

      > `tx_start_time` means when transaction starts. Transaction validity range's lower bound. (must have finite value)

      > `tx_time_gap` means how early transaction starts before `minting_start_time`. `tx_time_gap = minting_start_time - tx_start_time`

      - go through `whitelisted_value` which is array of `whitelisted_item` for aggregated `destination_address` and `ordered_amount`.

        > `remaining_ordered_amount`: The leftover amount from `ordered_amount` after checking whitelisted value.

        > `spent_lovelace_for_whitelisted`: Lovelace spent to mint H.A.L. NFTs as whitelisted using discounted price.

        > `ordered_amount` will be used as initial value of `remaining_ordered_amount` 0 as initial value of `spent_lovelace_for_whitelisted`

        1.  check `whitelisted_item`'s `amount` is available. If `amount` is less than or equal to 0, then remove that `whitelisted_item`.

        2.  Check if we can use `whitelisted_item`. If `tx_time_gap` is less than or equal to `time_gap` from `whitelisted_item`, cut the value of `whitelisted_item`'s `amount` by `Min(amount, remaining_ordered_amount)`. If `amount` becomes less than or equal to 0, remove this item. Also cut the value of `remaining_ordered_amount` by `Min(amount, remaining_ordered_amount)` - that will be `remaining_ordered_amount`.

        When we cut the `whitelisted_item`'s `amount` by `Min(amount, remaining_ordered_amount)`, we add `whiltelisted_item`'s `price` multiplied by `Min(amount, remaining_ordered_amount)` to `spent_lovelace_for_whitelisted`.

        3.  Continue `1.` and `2.` until `remaining_ordered_amount` becomes 0 or the end of `whitelisted_item` array.

        4.  By this operation, we get updated `whitelisted_value` and `remaining_ordered_amount` and `spent_lovelace_for_whitelisted`

      - check `remaining_ordered_amount`

        > If `remaining_ordered_amount` is bigger than 0 then transaction must start after `minting_start_time`. Because we couldn't mint `ordered_amount` of NFTs as whitelisted.

      - we update `Whitelist MPF`.

        - key: destination_address CBOR Hex

        - old value: `WhitelistedValue` CBOR Hex

        - new value: updated `WhitelistedValue` CBOR Hex

      - calculate `spent_lovelace_for_ordered_amount` which is the cost to mint all H.A.L. NFTs of aggregated order's amount

        `spent_lovelace_for_ordered_amount = spent_lovelace_for_whitelisted + hal_nft_price * remaining_ordered_amount`

    > After this operation we can `total_spent_lovelace` which is the sum of all `spent_lovelace_for_ordered_amount`

  - check minting engine is paid correctly

    `total_paid_lovelace` must be greater than or equal to `total_spent_lovelace`

  - first output must be `minting_data_output`; Output with `Minting Data NFT`.

    - must have correct datum with updated `MPF` `root_hash` and `Whitelist MPF` `root_hash` which can be calculated using `mpt.Proof` from `Proofs` in redeemer.

    - must have same value as spending UTxO. (which is `minting_data_input`)

  - must have reference outputs for all `hal_asset_names` (minted in this transaction)

    > `hal_asset_names` can be reduced from `List<AssetNameProofs>` from redeemer. (We make sure that only those assets are minted.)

    - each reference output address must be `ref_spend_proxy_script_hash from `Settings`.

    - must have only one Reference H.A.L. Asset.

    - must NOT have reference script.

  - for minted H.A.L. tokens, they must be only the ones from `List<AssetNameProofs>`.

    > each asset name will have 2 assets. (User Asset, Reference Asset)

- `UpdateMPT`: called When admin updates `MPF` `root_hash` or `Whitelist MPF` `root_hash`.

  - transaction must be signed by `admin_verification_key_hash` from Parameter

  - must not mint any assets

### 3.4 `orders_spend` spending validator

This validator manages the lifecycle of order UTxOs, including execution and cancellation and refunding of orders. Users will send lovelace with correctly OrderDatum to this spending validator to request H.A.L. NFTs.

#### 3.4.1 Parameter

- _hal_policy_id_: H.A.L. NFT's Minting Policy Id. (`mint_proxy` minting policy)
- _randomizer_: Randomizer Hex String used to change `orders_spend` spending validator address without changing logic.

#### 3.4.2 Datum

```rust
pub type OrderDatum {
  // the key hash of the wallet that placed the order that is used for cancelling the order
  owner_key_hash: ByteArray,
  // address that the asset should be sent to
  destination_address: Address,
  // amount of H.A.L. NFTs to mint
  amount: Int,
}
```

We accept `Data` as redeemer, because when users send money with invalid Datum, we need to refund that money to users.

#### 3.4.3 Redeemer

- `ExecuteOrders`

- `CancelOrder`

- `RefundOrder`

#### 3.4.4 Validation

- `ExecuteOrders`: called when minting engine mints H.A.L. NFTs spending `Order UTxOs` from this script.

  - must mint at least one H.A.L. NFT.

    > `mint` withdrawal validator will do all the validations. Since we don't support burning yet, we can simply check minted value has H.A.L. policy id or not.

- `CancelOrder`: called when an user cancels his Order.

  - `datum` must be type of `OrderDatum`.

  - transaction must be signed by `owner_key_hash` from `OrderDatum`.

  - there must be only one UTxO in transaction inputs from this script.

- `Refund Order`: called when admin refunds Order UTxO to user.

  - must attach `Settings` NFT in reference inputs.

  - must be signed by `allowed_minter` from `Settings`.

  - there must be only one UTxO in transaction inputs from this script.

  - first output must be refunded output.

    - output value must be greater than or equal to spending UTxO.

    - must be sent to `owner_key_hash` if datum is typeof `OrderDatum`.

### 3.5 `ref_spend_proxy` spending validator

This validator manages H.A.L. Reference NFTs with their datums.

#### 3.5.1 Parameter

None

#### 3.5.2 Datum

Anything

#### 3.5.3 Redeemer

Anything

#### 3.5.4 Validation

- must attach `RefSpendSettings` NFT in reference inputs.

- validate that `ref_spend_governor` withdrawal validator (`ref_spend` withdrawal validator) is executed.

### 3.6 `ref_spend` withdrawal validator

This is withdrawal validator which governs `ref_spend_proxy` spending validator. This is used not to change `ref_spend_proxy` script address whenever we update `ref_spend` logic.

#### 3.6.1 Parameter

None

#### 3.6.2 Datum

None (withdrawal validator)

#### 3.6.3 Redeemer

- `Update(AssetName)`

- `Migrate` (Not used for now)

#### 3.6.4 Validation

- must attach `RefSpendSettings` NFT in reference inputs.

- must be signed by `ref_spend_admin` from `RefSpendSettingsV1`.

- must spend H.A.L. User Asset whose name is `asset_name` from redeemer.

- there must be only one transaction input with H.A.L. Reference Asset.

  - that transaction input must have only one H.A.L. Reference Asset whose name is `asset_name` from redeemer.

- the first output must be `ref_spend_proxy_output`.

  - output address must be `ref_spend_proxy_script_hash` (same as transaction input).

  - output value must be same as transaction input value. (except lovelace)

  - output must have datum type of `CIP68Datum` (Inline Datum).

  - output must NOT have reference script.

### 3.7 `royalty_spend` spending validator

#### 3.7.1 Parameter

- _royalty_spend_admin_: Verification Key Hash of Admin Wallet who controls Royalty NFT. (This is Kora Lab Admin Wallet)

#### 3.7.2 Datum

See [CIP 102](https://cips.cardano.org/cip/CIP-0102)

```rust
pub type RoyaltyDatum {
  recipients: List<RoyaltyRecipient>,
  version: Int,
  extra: Data,
}

pub type RoyaltyRecipient {
  address: Address,
  // percentage (fraction)
  fee: Int,
  // fixed (absolute)
  min_fee: Option<Int>,
  // fixed (absolute)
  max_fee: Option<Int>,
}
```

We use `Data` because when `Royalty NFT` is sent with invalid datum, we can fix it.

#### 3.7.3 Redeemer

None

#### 3.7.4 Validation

- Transaction must be signed by `royalty_spend_admin` from Parameter
