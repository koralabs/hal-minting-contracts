import { makeAddress } from "@helios-lang/ledger";

// ------- De-Mi contract config -------
// This will change smart contract compiled code
export const MINT_VERSION = 0n;
export const ADMIN_VERIFICATION_KEY_HASH =
  "4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1";
// ------- End contract config -------

// ------- Settings Data -------

// allowed minter verification key hash
export const ALLOWED_MINTER =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";

// HAL NFT Price
export const HAL_NFT_PRICE = 180_000_000n;

export const PAYMENT_ADDRESS = makeAddress(
  "addr1xylxvryvzxddvl6jjeyjut2kmyhaf5pjmc933z74gmenk2e7vcxgcyv66el499jf9ck4dkf06ngr9hstrz9a23hn8v4sc89s5z"
);

// orders_minter
export const ORDERS_MINTER =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";

// ref_spend_admin
export const REF_SPEND_ADMIN =
  "976ec349c3a14f58959088e13e98f6cd5a1e8f27f6f3160b25e415ca";

// max_order_amount
export const MAX_ORDER_AMOUNT = 5;

// ------- End Settings Data -------
