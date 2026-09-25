// Order validation and aggregation into mint transactions.
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { Err, Ok, Result } from "ts-res";

import { inlineDatumOf, Utxo, utxoRef } from "../cardano/index.js";
import { decodeOrderDatumData, OrderDatum, SettingsV1, WhitelistedValue } from "../contracts/index.js";
import { convertError } from "../helpers/index.js";
import { isOrderTxInputValid } from "./order.js";
import { AggregatedOrder } from "./types.js";
import {
  getAvailableWhitelistedValue,
  getWhitelistedKey,
  getWhitelistedValue,
  updateWhitelistedValue,
  useWhitelistedValueAsPossible,
} from "./whitelist.js";

type CanMint =
  | { status: "invalid" | "unprocessable"; reason: string }
  | { status: "valid"; needWhitelistProof: boolean; newWhitelistedValue: WhitelistedValue | null };

const checkCanMintOrder = (
  amount: number,
  lovelace: bigint,
  halNftPrice: bigint,
  txTimeGap: number,
  whitelistedValue: WhitelistedValue | null,
  allWhitelistedValue: WhitelistedValue | null
): CanMint => {
  if (!whitelistedValue || whitelistedValue.length == 0) {
    // Not whitelisted (for this time gap): public price, only after minting_start_time.
    const expectedLovelace = halNftPrice * BigInt(amount);
    if (txTimeGap >= 0)
      return { status: "unprocessable", reason: "not whitelisted enough; wait till minting_start_time" };
    if (lovelace >= expectedLovelace)
      return { status: "valid", needWhitelistProof: false, newWhitelistedValue: whitelistedValue };
    return { status: "invalid", reason: `need ${expectedLovelace} but has only ${lovelace}` };
  }

  const { newWhitelistedValue, remainingOrderedAmount, spentLovelaceForWhitelisted } =
    updateWhitelistedValue(whitelistedValue, amount, txTimeGap);

  // Even using every whitelisted discount the address has, the order must cover its cost.
  if (allWhitelistedValue) {
    const best = useWhitelistedValueAsPossible(allWhitelistedValue, amount);
    const possibleExpectedLovelace =
      best.spentLovelaceForWhitelisted + halNftPrice * BigInt(best.remainingOrderedAmount);
    if (lovelace < possibleExpectedLovelace)
      return {
        status: "invalid",
        reason: `need ${possibleExpectedLovelace} even as whitelisted but has only ${lovelace}`,
      };
  }

  if (remainingOrderedAmount > 0) {
    // Part of the order is not covered by the whitelist: only after minting_start_time.
    if (txTimeGap >= 0)
      return {
        status: "unprocessable",
        reason: "cannot be minted ALL as whitelisted; wait till minting_start_time",
      };
    const expectedLovelace = halNftPrice * BigInt(remainingOrderedAmount) + spentLovelaceForWhitelisted;
    if (lovelace >= expectedLovelace)
      return { status: "valid", needWhitelistProof: true, newWhitelistedValue };
    return {
      status: "unprocessable",
      reason: `need ${expectedLovelace} for SOME as whitelisted but has only ${lovelace}`,
    };
  }

  if (lovelace >= spentLovelaceForWhitelisted)
    return { status: "valid", needWhitelistProof: true, newWhitelistedValue };
  return {
    status: "unprocessable",
    reason: `need ${spentLovelaceForWhitelisted} for ALL as whitelisted but has only ${lovelace}`,
  };
};

/**
 * Greedy, stable "sum-to-7" ordering: scanning left to right, each order is followed by the
 * fewest later orders that complete a group of exactly 7 HALs, when such a group exists.
 */
function orderToConsecutiveSum7<T extends { datum: { amount: number } }>(orders: T[]): T[] {
  const n = orders.length;
  const used: boolean[] = Array(n).fill(false);
  const out: T[] = [];

  const pick = (i: number, target: number, len: number): number[] | null => {
    if (!len) return target ? null : [];
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const v = orders[j].datum.amount;
      if (v > target) continue;
      const tail = pick(j, target - v, len - 1);
      if (tail) return [j, ...tail];
    }
    return null;
  };

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = true;
    out.push(orders[i]);
    const a = orders[i].datum.amount;
    if (a >= 7) continue;
    const need = 7 - a;
    for (let len = 1; len <= need; len++) {
      const combo = pick(i, need, len);
      if (combo) {
        for (const j of combo) {
          used[j] = true;
          out.push(orders[j]);
        }
        break;
      }
    }
  }
  return out;
}

const addOrderToAggregatedOrders = (
  aggregated: AggregatedOrder[],
  utxo: Utxo,
  destinationAddress: string,
  amount: number,
  needWhitelistProof: boolean
): AggregatedOrder[] => {
  const existing = aggregated.find((o) => o.destinationAddress === destinationAddress);
  if (!existing)
    return [...aggregated, { destinationAddress, amount, orderTxInputs: [utxo], needWhitelistProof }];
  return aggregated.map((o) =>
    o === existing
      ? {
          destinationAddress,
          amount: o.amount + amount,
          orderTxInputs: [...o.orderTxInputs, utxo],
          needWhitelistProof: o.needWhitelistProof || needWhitelistProof,
        }
      : o
  );
};

interface PrepareOrdersParams {
  isMainnet: boolean;
  orderTxInputs: Utxo[];
  settingsV1: SettingsV1;
  whitelistDB: Trie;
  mintingTime: number;
  maxOrderAmountInOneTx: number;
  maxTxsPerLambda: number;
  remainingHals: number;
}

interface PreparedOrdersResult {
  aggregatedOrdersList: Array<AggregatedOrder[]>;
  /** Valid orders left for a later run. */
  unpickedOrderTxInputs: Utxo[];
  /** Orders to refund: malformed, underpaid, or not mintable now. */
  invalidOrderTxInputs: Utxo[];
  invalidOrderReasons: Record<string, string>;
}

/**
 * @description Validate order UTxOs and aggregate them (by destination address) into at most
 * `maxTxsPerLambda` mint transactions of at most `maxOrderAmountInOneTx` HALs each.
 */
const prepareOrders = async (
  params: PrepareOrdersParams
): Promise<Result<PreparedOrdersResult, Error>> => {
  const {
    isMainnet,
    orderTxInputs,
    settingsV1,
    whitelistDB,
    mintingTime,
    maxOrderAmountInOneTx,
    maxTxsPerLambda,
    remainingHals,
  } = params;

  try {
    const invalidOrderTxInputs: Utxo[] = [];
    const invalidOrderReasons: Record<string, string> = {};
    const invalid = (utxo: Utxo, reason: string) => {
      invalidOrderTxInputs.push(utxo);
      invalidOrderReasons[utxoRef(utxo)] = reason;
    };

    const withDatum: { utxo: Utxo; datum: OrderDatum }[] = [];
    for (const utxo of orderTxInputs) {
      const check = isOrderTxInputValid({ isMainnet, orderTxInput: utxo, settingsV1, maxOrderAmountInOneTx });
      if (!check.ok) {
        invalid(utxo, check.error.message);
        continue;
      }
      withDatum.push({ utxo, datum: decodeOrderDatumData(inlineDatumOf(utxo), isMainnet) });
    }

    const txTimeGap = settingsV1.minting_start_time - mintingTime;
    const whitelistedValues: Record<string, WhitelistedValue | null> = {};
    const availableWhitelistedValues: Record<string, WhitelistedValue | null> = {};
    const validOrders: {
      utxo: Utxo;
      destinationAddress: string;
      amount: number;
      needWhitelistProof: boolean;
      addedToTx: boolean;
    }[] = [];

    for (const { utxo, datum } of orderToConsecutiveSum7(withDatum)) {
      const { destination_address, amount } = datum;
      const key = getWhitelistedKey(destination_address).toString("hex");
      if (!(key in whitelistedValues)) {
        const value = await getWhitelistedValue(whitelistDB, destination_address);
        whitelistedValues[key] = value;
        availableWhitelistedValues[key] = value ? getAvailableWhitelistedValue(value, txTimeGap) : null;
      }

      const canMint = checkCanMintOrder(
        amount,
        utxo[1].value.coins,
        settingsV1.hal_nft_price,
        txTimeGap,
        availableWhitelistedValues[key],
        whitelistedValues[key]
      );
      if (canMint.status === "valid") {
        whitelistedValues[key] = canMint.newWhitelistedValue;
        validOrders.push({
          utxo,
          destinationAddress: destination_address,
          amount,
          needWhitelistProof: canMint.needWhitelistProof,
          addedToTx: false,
        });
      } else {
        // Orders that cannot be minted now are refunded (users may not wait for them).
        invalid(utxo, `${canMint.status}: ${canMint.reason}`);
      }
    }

    let halsLeftToMint = remainingHals;
    const aggregatedOrdersList: AggregatedOrder[][] = [];
    while (halsLeftToMint > 0) {
      let tx: AggregatedOrder[] = [];
      for (const order of validOrders) {
        if (order.addedToTx) continue;
        const currentTxAmount = tx.reduce((total, { amount }) => amount + total, 0);
        if (currentTxAmount + order.amount <= Math.min(halsLeftToMint, maxOrderAmountInOneTx)) {
          order.addedToTx = true;
          tx = addOrderToAggregatedOrders(tx, order.utxo, order.destinationAddress, order.amount, order.needWhitelistProof);
        }
      }
      if (tx.length === 0) break;
      aggregatedOrdersList.push(tx);
      halsLeftToMint -= tx.reduce((total, { amount }) => amount + total, 0);
      if (aggregatedOrdersList.length >= maxTxsPerLambda) break;
    }

    const unpickedOrderTxInputs: Utxo[] = [];
    for (const order of validOrders.filter((o) => !o.addedToTx)) {
      if (order.amount <= halsLeftToMint) unpickedOrderTxInputs.push(order.utxo);
      else invalid(order.utxo, `not enough HALs left (${halsLeftToMint}) for ${order.amount}`);
    }

    return Ok({ aggregatedOrdersList, unpickedOrderTxInputs, invalidOrderTxInputs, invalidOrderReasons });
  } catch (error) {
    return Err(new Error(`Failed to prepare orders: ${convertError(error)}`));
  }
};

export type { PrepareOrdersParams, PreparedOrdersResult };
export { orderToConsecutiveSum7, prepareOrders };
