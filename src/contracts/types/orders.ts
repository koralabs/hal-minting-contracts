import { ShelleyAddress } from "@helios-lang/ledger";

interface OrderDatum {
  // the key hash of the wallet that placed the order that is used for cancelling the order
  owner_key_hash: string;
  // price of HAL NFT in lovelace
  price: bigint;
  // address that the asset should be sent to
  destination_address: ShelleyAddress;
  // amount of HAL NFTs to mint
  amount: number;
}

export type { OrderDatum };
