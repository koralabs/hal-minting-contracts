interface OrderDatum {
  // the key hash of the wallet that placed the order that is used for cancelling the order
  owner_key_hash: string;
  // address that the asset should be sent to
  // (bech32; base or enterprise)
  destination_address: string;
  // amount of HAL NFTs to mint
  amount: number;
}

export type { OrderDatum };
