// Whitelist arithmetic; mirrors the on-chain `update_whitelisted_value` of the minting_data validator.
import { Trie } from "@aiken-lang/merkle-patricia-forestry";

import { addressToData } from "../cardano/index.js";
import { decodeWhitelistedValueFromCBOR, WhitelistedValue } from "../contracts/index.js";

/** The whitelist MPT key of an address: the CBOR of its Plutus `Address` data. */
const getWhitelistedKey = (address: string): Buffer =>
  Buffer.from(addressToData(address).toCbor(), "hex");

const getWhitelistedValue = async (
  whitelistDB: Trie,
  destinationAddress: string
): Promise<WhitelistedValue | null> => {
  try {
    const whitelistedValueCbor = await whitelistDB.get(getWhitelistedKey(destinationAddress));
    if (!whitelistedValueCbor) return null;
    const whitelistedValueResult = decodeWhitelistedValueFromCBOR(whitelistedValueCbor);
    if (!whitelistedValueResult.ok) {
      console.error(
        `Address ${destinationAddress} has invalid whitelisted item data in Trie: ${whitelistedValueResult.error}`
      );
      return null;
    }
    return whitelistedValueResult.data;
  } catch (error) {
    console.error(`Failed to get whitelisted value for Address ${destinationAddress} in Trie`, error);
    return null;
  }
};

type UpdateWhitelistedValueResult = {
  newWhitelistedValue: WhitelistedValue;
  remainingOrderedAmount: number;
  spentLovelaceForWhitelisted: bigint;
};

/**
 * Spend whitelisted items (in order) against `orderedAmount`: an item is usable when the tx time gap
 * is within its `time_gap`; each used unit costs the item's price.
 * Returns: (new_whitelisted_value, remaining_ordered_amount, spent_lovelace_for_whitelisted)
 */
const updateWhitelistedValue = (
  whitelistedValue: WhitelistedValue,
  orderedAmount: number,
  transactionTimeGap: number
): UpdateWhitelistedValueResult =>
  whitelistedValue.reduce<UpdateWhitelistedValueResult>(
    (acc, cur) => {
      if (cur.amount <= 0) return acc;
      if (transactionTimeGap > cur.time_gap)
        return { ...acc, newWhitelistedValue: [...acc.newWhitelistedValue, cur] };
      const used = Math.min(cur.amount, acc.remainingOrderedAmount);
      const left = cur.amount - used;
      return {
        newWhitelistedValue:
          left <= 0 ? acc.newWhitelistedValue : [...acc.newWhitelistedValue, { ...cur, amount: left }],
        remainingOrderedAmount: acc.remainingOrderedAmount - used,
        spentLovelaceForWhitelisted: acc.spentLovelaceForWhitelisted + cur.price * BigInt(used),
      };
    },
    {
      newWhitelistedValue: [],
      remainingOrderedAmount: orderedAmount,
      spentLovelaceForWhitelisted: BigInt(0),
    }
  );

/** Like `updateWhitelistedValue`, ignoring time gaps: the cheapest an order could possibly be. */
const useWhitelistedValueAsPossible = (
  whitelistedValue: WhitelistedValue,
  orderedAmount: number
): UpdateWhitelistedValueResult =>
  updateWhitelistedValue(whitelistedValue, orderedAmount, Number.NEGATIVE_INFINITY);

const getAvailableWhitelistedValue = (
  whitelistedValue: WhitelistedValue,
  txTimeGap: number
): WhitelistedValue =>
  whitelistedValue.filter((item) => item.amount > 0 && item.time_gap >= txTimeGap);

export type { UpdateWhitelistedValueResult };
export {
  getAvailableWhitelistedValue,
  getWhitelistedKey,
  getWhitelistedValue,
  updateWhitelistedValue,
  useWhitelistedValueAsPossible,
};
