import { MPTProof } from "./mpt.js";

interface MintingData {
  mpt_root_hash: string;
}

// asset hex name without asset name label
type Fulfilment = Array<[string, MPTProof]>;

export type { Fulfilment, MintingData };
