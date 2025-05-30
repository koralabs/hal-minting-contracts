use aiken/transaction/credential.{Address}

pub const order_asset_name = "HAL_ORDER"

pub type OrderDatum {
  // the key hash of the wallet that placed the order that is used for cancelling the order
  owner_key_hash: ByteArray,
  // price of HAL NFT in lovelace
  price: Int,
  // address that the asset should be sent to
  destination_address: Address,
  // amount of HAL NFTs to mint
  amount: Int,
}
