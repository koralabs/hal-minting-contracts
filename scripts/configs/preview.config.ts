import { makeAddress } from "@helios-lang/ledger";

// ------- H.A.L. Mint Contracts Config -------
// This will change smart contracts compiled code

// H.A.L. policy id will change
export const MINT_VERSION = 0n;

// `minting_data.spend` contract code will change
export const ADMIN_VERIFICATION_KEY_HASH =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";

// `orders_spend.spend` contract will change
export const ORDERS_SPEND_RANDOMIZER = "";

// `royalty_spend.spend` contract will change
export const ROYALTY_SPEND_ADMIN =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";
// ------- End H.A.L. Mint Contracts Config -------

// ------- Settings Data -------

// allowed minter verification key hash
export const ALLOWED_MINTER =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";

// HAL NFT Price
export const HAL_NFT_PRICE = 180_000_000n;

export const PAYMENT_ADDRESS = makeAddress(
  "addr_test1qz96txepzdhj7ryyse0mq9a97eey2es07dydshr9cgapgyv06l2rv7x0p0vtg5kufwj3avaa909ex8uswsnxnad9ccqsyaga0j"
);

// minting start time (POSIX time)
// after when anyone can mint HAL NFTs
export const MINTING_START_TIME = 1752537600000;

// ------- End Settings Data -------

// ------- Ref Spend Settings Data -------

// ref spend admin
export const REF_SPEND_ADMIN =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";

// ------- End Ref Spend Settings Data -------
