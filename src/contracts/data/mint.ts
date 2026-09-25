import { constr, PlutusData } from "../../cardano/index.js";

const buildMintMintNFTsRedeemer = (): PlutusData => constr(0);

const buildMintBurnNFTsRedeemer = (): PlutusData => constr(1);

const buildMintMintRoyaltyNFTRedeemer = (): PlutusData => constr(2);

export {
  buildMintBurnNFTsRedeemer,
  buildMintMintNFTsRedeemer,
  buildMintMintRoyaltyNFTRedeemer,
};
