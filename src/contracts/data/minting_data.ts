import { TxOutputDatum } from "@helios-lang/ledger";
import {
  expectByteArrayData,
  expectConstrData,
  makeByteArrayData,
  makeConstrData,
  makeListData,
  UplcData,
} from "@helios-lang/uplc";

import { invariant } from "../../helpers/index.js";
import { Fulfilment, MintingData } from "../types/index.js";
import { buildMPTProofData } from "./mpt.js";

const buildMintingData = (mintingData: MintingData): UplcData => {
  return makeConstrData(0, [makeByteArrayData(mintingData.mpt_root_hash)]);
};

const decodeMintingDataDatum = (
  datum: TxOutputDatum | undefined
): MintingData => {
  invariant(
    datum?.kind == "InlineTxOutputDatum",
    "Minting Data Datum must be inline datum"
  );
  const datumData = datum.data;
  const mintingDataConstrData = expectConstrData(datumData, 0, 1);

  const mpt_root_hash = expectByteArrayData(
    mintingDataConstrData.fields[0],
    "mpt_root_hash must be ByteArray"
  ).toHex();

  return { mpt_root_hash };
};

const buildFulfilmentData = (fulfilment: Fulfilment): UplcData => {
  return makeListData(
    fulfilment.map(([asset_name, mpt_proof]) =>
      makeListData([
        makeByteArrayData(asset_name),
        buildMPTProofData(mpt_proof),
      ])
    )
  );
};

const buildMintingDataMintRedeemer = (fulfilments: Fulfilment[]): UplcData => {
  return makeConstrData(0, [
    makeListData(fulfilments.map(buildFulfilmentData)),
  ]);
};

const buildMintingDataUpdateMPTRedeemer = (): UplcData => {
  return makeConstrData(1, []);
};

export {
  buildMintingData,
  buildMintingDataMintRedeemer,
  buildMintingDataUpdateMPTRedeemer,
  decodeMintingDataDatum,
};
