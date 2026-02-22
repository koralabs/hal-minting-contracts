# Data Model

## Constants and Identifiers

| Symbol | Value | Meaning |
| --- | --- | --- |
| `PREFIX_100` | `000643b0` | Reference token label |
| `PREFIX_222` | `000de140` | User NFT label |
| `SETTINGS_HANDLE_NAME` | `hal@handle_settings` | HAL settings asset |
| `REF_SPEND_SETTINGS_HANDLE_NAME` | `hal_pz@handle_settings` | Ref-spend settings asset |
| `MINTING_DATA_HANDLE_NAME` | `hal_root@handle_settings` | Minting-data asset |
| `MPT_MINTED_VALUE` | `minted` | Trie marker for consumed/minted asset names |
| `ROYALTY_ASSET_FULL_NAME` | `001f4d70526f79616c7479` | Royalty token full asset name |

Defined in `src/constants/index.ts`.

## Core Types

### Settings (`src/contracts/types/settings.ts` + `settings_v1.ts`)
- `Settings`:
  - `mint_governor: string`
  - `mint_version: bigint`
  - `data: UplcData`
- `SettingsV1`:
  - `policy_id`
  - `allowed_minter`
  - `hal_nft_price`
  - `minting_data_script_hash`
  - `orders_spend_script_hash`
  - `ref_spend_proxy_script_hash`
  - `ref_spend_governor`
  - `ref_spend_admin`
  - `royalty_spend_script_hash`
  - `minting_start_time`
  - `payment_address`

### Ref Spend Settings
- `RefSpendSettingsV1`:
  - `policy_id`
  - `ref_spend_admin`

### Minting Data (`src/contracts/types/minting_data.ts`)
- `mpt_root_hash: string`
- `whitelist_mpt_root_hash: string`

### Proof Types
- `AssetNameProof = [asset_hex_name, mpt_proof]`
- `WhitelistProof = [whitelisted_value, mpt_proof]`
- `Proofs = [AssetNameProof[], WhitelistProof | undefined]`

### Whitelist Types (`src/contracts/types/whitelist.ts`)
- `WhitelistedItem`:
  - `time_gap: number`
  - `amount: number`
  - `price: bigint`
- `WhitelistedValue = WhitelistedItem[]`

## Datum/Redeemer Encoding Surfaces
- Settings codecs:
  - `buildSettingsData`, `decodeSettingsDatum`
  - `buildSettingsV1Data`, `decodeSettingsV1Data`
- Minting data codecs:
  - `buildMintingData`, `decodeMintingDataDatum`
  - mint redeemers include proof lists and whitelist proof payloads
- Orders codecs:
  - `buildOrderDatumData`, `decodeOrderDatumData`
  - cancel/refund/execute redeemers for `orders_spend`
- Royalty/ref datums:
  - royalty datum encoding for royalty spend output
  - reference datum path requires inline datum replacement via ref-spend flow

## Deployment Data Shape

`DeployData` from `src/txs/deploy.ts` includes:
- `optimizedCbor`
- `unOptimizedCbor?`
- `datumCbor?`
- `validatorHash`
- optional `policyId`, `scriptAddress`, `scriptStakingAddress`

`DeployedScripts` includes script details + reference UTxOs for all 7 HAL contracts.
