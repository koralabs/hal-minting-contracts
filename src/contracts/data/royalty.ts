import { constr, int, list, PlutusData } from "../../cardano/index.js";
import { RoyaltyDatum, RoyaltyRecipient } from "../types/index.js";
import { buildAddressData, makeOptionData } from "./common.js";

const buildRoyaltyDatumData = (royaltyDatum: RoyaltyDatum): PlutusData => {
  const { recipients, version, extra } = royaltyDatum;
  return constr(0, [
    list(recipients.map(buildRoyaltyRecipientData)),
    int(version),
    extra,
  ]);
};

const buildRoyaltyRecipientData = (recipient: RoyaltyRecipient): PlutusData => {
  const { address, fee, min_fee, max_fee } = recipient;
  return constr(0, [
    buildAddressData(address),
    int(convertPercentageToOnChainPercentage(fee)),
    makeOptionData(min_fee, int),
    makeOptionData(max_fee, int),
  ]);
};

/**
 * @description Converts a percentage between 0 and 100 inclusive to the CIP-102 fee format
 * @example percentage = 1.6% -> onChainPercentage = 625
 */
const convertPercentageToOnChainPercentage = (percent: number): bigint => {
  if (percent < 0.1 || percent > 100) {
    throw new Error("Royalty fee must be between 0.1 and 100 percent");
  }
  return BigInt(Math.floor(1 / (percent / 1000)));
};

/**
 * @description Converts a CIP-102 fee format to a percentage between 0 and 100 inclusive
 * @example onChainPercentage = 625 -> percentage = 1.6%
 */
const convertOnChainPercentageToPercentage = (onChainPercentage: bigint): number =>
  1000 / Number(onChainPercentage);

export {
  buildRoyaltyDatumData,
  buildRoyaltyRecipientData,
  convertOnChainPercentageToPercentage,
  convertPercentageToOnChainPercentage,
};
