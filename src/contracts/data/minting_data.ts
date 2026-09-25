import {
  bytes,
  constr,
  expectBytes,
  expectConstr,
  list,
  PlutusData,
} from "../../cardano/index.js";
import { invariant } from "../../helpers/index.js";
import {
  AssetNameProof,
  MintingData,
  Proofs,
  WhitelistProof,
} from "../types/index.js";
import { makeOptionData } from "./common.js";
import { buildMPTProofData } from "./mpt.js";
import { makeWhitelistedValueData } from "./whitelist.js";

const buildMintingData = (mintingData: MintingData): PlutusData =>
  constr(0, [
    bytes(mintingData.mpt_root_hash),
    bytes(mintingData.whitelist_mpt_root_hash),
  ]);

/** `datum` is the minting-data (hal_root) UTxO's inline datum. */
const decodeMintingDataDatum = (datum: PlutusData | undefined): MintingData => {
  invariant(datum, "Minting Data Datum must be inline datum");
  const { fields } = expectConstr(datum, "MintingData", 0, 2);
  return {
    mpt_root_hash: expectBytes(fields[0], "mpt_root_hash"),
    whitelist_mpt_root_hash: expectBytes(fields[1], "whitelist_mpt_root_hash"),
  };
};

const buildAssetNameProofData = ([asset_name, mpt_proof]: AssetNameProof): PlutusData =>
  list([bytes(asset_name), buildMPTProofData(mpt_proof)]);

const buildWhitelistProofData = ([whitelisted_value, mpt_proof]: WhitelistProof): PlutusData =>
  list([makeWhitelistedValueData(whitelisted_value), buildMPTProofData(mpt_proof)]);

const buildProofsData = ([assetNameProofs, whitelistProofOpt]: Proofs): PlutusData =>
  list([
    list(assetNameProofs.map(buildAssetNameProofData)),
    makeOptionData(whitelistProofOpt, buildWhitelistProofData),
  ]);

const buildMintingDataMintRedeemer = (proofsList: Proofs[]): PlutusData =>
  constr(0, [list(proofsList.map(buildProofsData))]);

const buildMintingDataUpdateMPTRedeemer = (): PlutusData => constr(1);

export {
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintingDataUpdateMPTRedeemer,
  decodeMintingDataDatum,
};
