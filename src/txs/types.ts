import { Cardano, PlutusData, Utxo } from "../cardano/index.js";

// Order from user's perspective
type Order = {
  /** bech32 */
  destinationAddress: string;
  amount: number;
  // users can pass cost to process this order
  // sum of normal price or whitelisted price
  cost: bigint;
};

// Aggregated Order by destination address
type AggregatedOrder = {
  /** bech32 */
  destinationAddress: string;
  amount: number;
  // order UTxOs which are aggregated
  orderTxInputs: Utxo[];
  // need whitelist proof or not
  needWhitelistProof: boolean;
};

// H.A.L. Asset's Info
type HalAssetInfo = {
  assetUtf8Name: string;
  /** The CIP-68 reference datum. */
  assetDatum: PlutusData;
};

// H.A.L. User's Output Data
// one user output has many H.A.L. User Assets
interface HalUserOutputData {
  assetUtf8Names: string[];
  /** bech32 */
  destinationAddress: string;
  userOutput: Cardano.TxOut;
}

export type { AggregatedOrder, HalAssetInfo, HalUserOutputData, Order };
