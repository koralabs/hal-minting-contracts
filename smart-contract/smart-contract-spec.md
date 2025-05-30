# This is H.A.L. Minting Engine Specification

## 1. Overview

- H.A.L. minting engine allows users to mint NFT amongst pre-defined 10,000 NFTs. We use [Merkle Patricia Forestry](https://github.com/aiken-lang/merkle-patricia-forestry) to check that no asset which is not pre-defined is minted and no same asset is minted.

- H.A.L. minting engine uses batcher to collect orders from users and mint several NFTs in a single transaction. So users won't know anything about NFT's datum when they request an order. Batcher is white-listed wallet (in `Settings`) and it's the only one who can mint NFTs.

## 2. Specification

### 2.1 Actors

- User: An entity who wants to mint NFTs. The only thing user has to do is to request an order. (which will creates `Order NFT` and `Order UTxO`)

- Batcher: An entity who collects all orders and mint NFTs. He must be white-listed in `Settings`.

- Admin: An entity who can update `MPF` `root_hash`. The only requirement is NOT to mint any assets. (He is parameterized in the smart contract)

- Kora Lab Admin: An entity who can update `Settings`. (He has `Settings` NFT in his wallet)

### 2.2 Tokens

- H.A.L. NFT: Main NFT for H.A.L. project. Users will receive this NFT when their orders are processed.

  - Policy Id: `mint_proxy` minting policy

  - Asset Name: Among pre-defined 10,000 assets names

- Order Token: The token user will get at the time when they request an order. This token proves validity of `Order UTxO` to `Batcher`. This token must be only attached with `Order UTxO` in Orders Spend Script. (this is guaranteed by smart contract)

  - Policy Id: `orders_mint` minting policy

  - Asset Name: `"HAL_ORDER"` (Defined in `hal_nft_mint/orders.ak`)

- Settings NFT: This is Global `Settings` NFT. The global settings is saved in the form of datum attached to this token in `Kora Lab Admin`'s wallet.

  - Policy Id: `"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"` Legacy Ada Handle's policy id (Defined in `hal_nft_mint/settings.ak`)

  - Asset Name: `"hal@handle_settings"` (Defined in `hal_nft_mint/settings.ak`)

- Minting Data NFT: This is NFT which holds Merkle Patricia Forestry's root hash in the form of datum in `minting_data` spending validator. This root hash is updated every time NFT is minted.

  - Policy Id: `"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"` Legacy Ada Handle's policy id (Defined in `hal_nft_mint/minting_data.ak`)

  - Asset Name: `"hal_root@handle_settings"` (Defined in `hal_nft_mint/minting_data.ak`)

### 2.3 Smart Contracts

H.A.L. minting engine works by the combination of 6 smart contracts.

- `mint_proxy` minting policy

- `mint_v1` withdrawal validator

- `minting_data` spending validator

- `orders_mint` minting policy

- `orders_spend` spending validator

- `ref_spend` spending validator

## 3. Smart Contracts Detail

### 3.1 `mint_proxy` minting policy

This is minting policy which mints H.A.L. assets

#### 3.1.1 Parameter

- _version_: The minting policy's version. This is used to indicate that the H.A.L. NFT's version. If this version is changed, H.A.L. NFT's policy id will change

#### 3.1.2 Datum

None (minting policy)

#### 3.1.3 Redeemer

Anything

#### 3.1.4 Validation

- must attach `Settings` NFT in reference inputs

- _version_ in Parameter must be greater than or equal to 0 and must have same value as `Settings.version`.

- validate that `mint_governor` withdrawal validator (`mint_v1` withdrawal validator) is executed

### 3.2 `mint_v1` withdrawal validator

This is withdrawal validator which must be executed in order to mint H.A.L. NFT. This is used not to change H.A.L. NFT's policy id whenever we update minting engine's logic.

#### 3.2.1 Parameter

- _minting_data_script_hash_: This is script hash of `minting_data` spending validator.

  > This implies that whenever `minting_data` spending validator is updated, we must update `mint_v1` withdrawal validator also.

#### 3.2.2 Datum

None (withdrawal validator)

#### 3.2.3 Redeemer

- `MintNFTs`

- `BurnNFTs`

#### 3.2.4 Validation

- `MintNFTs`: called when minting engine tries to mint H.A.L. NFTs.

  - must spend `minting_data` UTxO. (with `Minting Data NFT`)

  - check that `minting_data` UTxO is from `minting_data_script_hash` from Parameter.

- `BurnNFTs`: called when minting engine tries to burn H.A.L. NFTs.

  - Burning is not supported yet.

### 3.3 `minting_data` spending validator

This is spending validator where `Minting Data NFT` is saved with `MPF` `root_hash`. (which is holding information of which asset names are minted or not amongst pre-defined ones)

#### 3.3.1 Parameter

- _admin_verification_key_hash_: This is wallet's public key hash. This is `Admin`'s wallet and is used to update `MPF` `root_hash` without actual minting H.A.L. NFTs.

#### 3.3.2 Datum

Anything (But that is actually `MintingData` type, we use `Data` type just for case when we accidentally send `Minting Data NFT` with invalid datum)

#### 3.3.3 Redeemer

- `Mint(List<Fulfilments>)`

- `UpdateMPT`

#### 3.3.4 Validation

- `Mint(List<Fulfilments>)`: called when minting engine tries to mint H.A.L. NFTs.

  - must attach `Settings` NFT in reference inputs.

  - must be signed by `allowed_minter` from `Settings`.

  - assume that transaction inputs contains valid Order UTxOs from `orders_spend_script_address`.

    - every order UTxO must have only one `Order NFT` and must have correct datum which is `OrderDatum` type. (`OrderDatum` contains `destination_address` where H.A.L. NFT will be sent and `price` of H.A.L. NFT.)

  - assume that transaction outputs are ordered like this

    - minting_data_output: Output with updated `MPF` `root_hash`.

      - must have correct datum with updated `MPF` `root_hash` which can be calculated using `mpt_proof` from `Fulfilments` in redeemer.

        - value of key `asset_name` must be empty string `""`.

        - update value to `"minted"`.

      - must have same value as spending UTxO. (which is `minting_data_input`)

      > `Fulfilments` in redeemer must be in `REVERSE` order as `Order UTxOs` in transaction inputs

    - order_nfts_output: Output with collected `Order NFTs` (which will be burnt later)

      - must have `Order NFTs` of `amount` same as Order UTxOs amount

    - rest_outputs: List of Pair of (`reference output`, `user_output`).

      - `reference_output` address must be `ref_spend_script_address` in smart contract.

      - `reference_output` must have reference H.A.L. asset with `asset_name`. (100 asset name label)

      - `reference_output` must NOT have reference_script.

      - `user_output` address must be `destination_address`.

      - `user_output` must have user H.A.L. asset with `asset_name`. (222 asset name label)

      > The pairs must be in `REVERSE` order as `Order UTxOs` in transaction inputs. (Same order as `Fulfilments`)

    - payment_output: Last output must be payment output for H.A.L. NFTs minting cost.

      - must have more or equal lovelace to H.A.L. NFTs minting cost which is sum of `price` multiplied by `amount` (from `OrderDatum`) of all `Order UTxOs` substracted by min lovelace used for `reference_output` and `user_output` and transaction fee.

        > Order UTxO must pay everything.

    - assure that Pair of H.A.L. `reference_asset` and `user_asset` for `Fulfilments` are minted

    - assure that Order NFTs are burnt (same amount as H.A.L. NFTs. `Ref` and `User` NFTs correspond one Order NFT.)

- `UpdateMPT`: called when `Admin` tries to update `MPF` `root_hash`.

  - transaction must be signed by `admin_verification_key_hash` from Parameter

  - must not mint any assets

### 3.4 `orders_mint` minting policy

This is minting policy which mints `Order NFT` which proves that `Order UTxO` is valid.

#### 3.4.1 Parameter

- _hal_policy_id_: H.A.L. NFT's Minting Policy Id (`mint_proxy` minting policy)

#### 3.4.2 Datum

None (minting policy)

#### 3.4.3 Redeemer

- `MintOrders(List<Address>)`

- `ExecuteOrders`

- `CancelOrder`

#### 3.4.4 Validation

- `MintOrders(destination_address: Address, amount: Int)`: called when a user tries to request order to mint H.A.L. NFTs

  - must attach `Settings` NFT in reference inputs.

  - `own_minting_policy` (policy id of itself) must be same as `orders_mint_policy_id` from `Settings`

  - must be signed by `orders_minter` from `Settings`

    - This will guarantee that white-listed users can mint early and others have to wait till minting opens to every body.

  - `amount` must be positive.

  - `amount` must not exceed `max_order_amount` from `Settings`.

  - must have valid order output. We assume this output is first output in the transaction outputs.

    - Order output address must be `orders_spend_script_address` from `Settings`.

    - Order output datum must be valid `OrderDatum` format.

      - `price` must be same as `hal_nft_price` from `Settings`.

      - `destination_address` must be same as `destination_address` from Redeemer.

      - `amount` must be same as `amount` from Redeemer.

    - must have only one `Order NFT`. (which is minted in the same transaction)

    - must have enough lovelace. (bigger than or equal to `price * amount`)

    - must NOT have `reference_script`.

  - Only one `Order NFT` is minted.

- `BurnOrders`: called when burn Order NFTs (when a user cancels his Order, when burn empty Order NFTs)

  - Must only burn Order NFTs

    - `asset_name` must be `HAL_ORDER`.

    - `quantity` must be negative.

### 3.5 `orders_spend` spending validator

#### 3.5.1 Parameter

- _hal_policy_id_: H.A.L. NFT's Minting Policy Id (`mint_proxy` minting policy)

- _orders_mint_policy_id_: Order NFT's Minting Policy Id (`orders_mint` minting policy)

#### 3.5.2 Datum

`OrderDatum`

- `owner_key_hash`: wallet's public key hash which is used when a user tries to cancel his order

- `price`: H.A.L. NFT's price (`hal_nft_price` from `Settings` at the time a user requests order)

- `destination_address`: Address to send H.A.L. NFT after that is minted.

#### 3.5.3 Redeemer

- `ExecuteOrders`: called when minting engine tries to mint H.A.L. NFTs spending `Order UTxOs`.

  - at least one of H.A.L. NFTs (`hal_nft_policy_id` from Parameter) are minted. Because other contracts (`minting_data`) will do validations.

- `CancelOrder`: called when a user tries to cancel his order and retrieve his lovelace.

  - transaction must be signed by `owner_key_hash` in `OrderDatum`

  - there must be only one UTxO from this script (`orders_spend` spending validator) in transaction inputs.

    > A user can NOT cancel 2 (or more) orders in the same transaction.

  - must burn only one `Order NFT`

### 3.6 `ref_spend` spending validator

#### 3.6.1 Parameter

None

#### 3.6.2 Datum

Anything

#### 3.6.3 Redeemer

- `Update(AssetName)`

- `Migrate`

#### 3.6.4 Validation

- `Update(AssetName)`: called when user tries to update H.A.L. NFT's datum.

  - must attach `Settings` NFT in reference inputs.

  - must be signed by `ref_spend_admin` from `Settings`.

  - spending UTxO must have only one reference asset with `asset_name` from redeemer.

  - there must be H.A.L. user asset in transaction inputs.

  - there must be only one UTxO spending in inputs from this script.

  - first output must be UTxO with reference asset.

    - must have same value as spending input. (except `lovelace` because that can change)

    - must NOT have reference_script.

    - output address must be same as spending input or `ref_spend_script_address` from `Settings`.

- `Migrate`: called when user (or admin) tries to migrate reference asset to latest Ref Spend script.

  - must attach `Settings` NFT in reference inputs.

  - first output must be UTxO with reference asset.

    - output address must be same as `ref_spend_script_address` from `Settings`.

    - must have same value as spending input.

    - must have same datum as spending input.

    - must NOT have reference_script.
