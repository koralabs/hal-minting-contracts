import { makeAddress } from "@helios-lang/ledger";

// ------- H.A.L. Mint Contracts Config -------
// This will change smart contracts compiled code

// H.A.L. policy id will change
export const MINT_VERSION = 0n;

// `minting_data.spend` contract code will changeg
export const ADMIN_VERIFICATION_KEY_HASH =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";

// `orders_spend.spend` contract will change
export const ORDERS_SPEND_RANDOMIZER = "";

// `royalty_spend.spend` contract will change
export const ROYALTY_SPEND_ADMIN =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";
// ------- End H.A.L. Mint Contracts Config -------

// ------- Settings Data -------

// allowed minter verification key hash
export const ALLOWED_MINTER =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";

// HAL NFT Price
export const HAL_NFT_PRICE = 180_000_000n;

export const PAYMENT_ADDRESS = makeAddress(
  "addr1xylxvryvzxddvl6jjeyjut2kmyhaf5pjmc933z74gmenk2e7vcxgcyv66el499jf9ck4dkf06ngr9hstrz9a23hn8v4sc89s5z"
);

// minting start time (POSIX time)
// after when anyone can mint HAL NFTs
export const MINTING_START_TIME = 1752537600000;

// ------- End Settings Data -------

// ------- Ref Spend Settings Data -------

// ref spend admin
export const REF_SPEND_ADMIN =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";

// ------- End Ref Spend Settings Data -------
