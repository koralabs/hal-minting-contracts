import {
  makeConstrData,
  makeIntData,
  makeListData,
  UplcData,
} from "@helios-lang/uplc";

import { RoyaltyDatum, RoyaltyRecipient } from "../types/index.js";
import { buildAddressData, makeOptionData } from "./common.js";

const buildRoyaltyDatumData = (royaltyDatum: RoyaltyDatum): UplcData => {
  const { recipients, version, extra } = royaltyDatum;

  return makeConstrData(0, [
    makeListData(recipients.map(buildRoyaltyRecipientData)),
    makeIntData(version),
    extra,
  ]);
};

const buildRoyaltyRecipientData = (recipient: RoyaltyRecipient): UplcData => {
  const { address, fee, min_fee, max_fee } = recipient;

  return makeConstrData(0, [
    buildAddressData(address),
    makeIntData(convertPercentageToOnChainPercentage(fee)),
    makeOptionData(min_fee, makeIntData),
    makeOptionData(max_fee, makeIntData),
  ]);
};

/**
 * @description Converts a percentage between 0 and 100 inclusive to the CIP-102 fee format
 * @example percentage = 1.6% -> onChainPercentage = 625
 * @param {number} percent
 * @returns {bigint}
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
 * @param {bigint} onChainPercentage
 * @returns {number}
 */
const convertOnChainPercentageToPercentage = (
  onChainPercentage: bigint
): number => {
  return 1000 / Number(onChainPercentage);
};

export {
  buildRoyaltyDatumData,
  buildRoyaltyRecipientData,
  convertOnChainPercentageToPercentage,
  convertPercentageToOnChainPercentage,
};
