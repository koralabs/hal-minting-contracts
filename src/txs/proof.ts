import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { Address } from "@helios-lang/ledger";
import { Err, Ok, Result } from "ts-res";

import { MPT_MINTED_VALUE } from "../constants/index.js";
import { MPTProof, parseMPTProofJSON } from "../contracts/index.js";
import { convertError } from "../helpers/index.js";

interface Proof {
  // hex name without asset name label
  asset_name: string;
  mpt_proof: MPTProof;
}

interface OrderedAsset {
  hexName: string;
  utf8Name: string;
  destinationAddress: Address;
  price: bigint;
}

/**
 * @interface
 * @typedef {object} BuildProofsParams
 * @property {OrderedAsset[]} orderedAssets Ordered Assets
 * @property {Trie} db Trie DB
 */
interface BuildProofsParams {
  orderedAssets: OrderedAsset[];
  db: Trie;
}

/**
 * @description Build Proofs of Assets
 * @param {BuildProofsParams} params
 * @returns {Promise<Result<Proof[],  Error>>} Transaction Result
 */
const buildProofs = async (
  params: BuildProofsParams
): Promise<Result<Proof[], Error>> => {
  const { orderedAssets, db } = params;

  // make Proofs for Minting Data V1 Redeemer
  const proofs = [];
  for (const orderedAsset of orderedAssets) {
    const { utf8Name, hexName } = orderedAsset;
    try {
      const hasKey = typeof (await db.get(utf8Name)) !== "undefined";
      if (!hasKey) {
        throw new Error(`Asset name is not pre-defined: ${utf8Name}`);
      }

      const mpfProof = await db.prove(utf8Name);
      await db.delete(utf8Name);
      await db.insert(utf8Name, MPT_MINTED_VALUE);
      proofs.push({
        asset_name: hexName,
        mpt_proof: parseMPTProofJSON(mpfProof.toJSON()),
      });
    } catch (error) {
      return Err(new Error(convertError(error)));
    }
  }

  return Ok(proofs);
};

export { buildProofs };

export type { BuildProofsParams, OrderedAsset, Proof };
