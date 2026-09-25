import type { PlutusData } from "../../cardano/sdk.js";

interface RoyaltyDatum {
  recipients: Array<RoyaltyRecipient>;
  version: number;
  extra: PlutusData;
}

interface RoyaltyRecipient {
  // bech32
  address: string;
  // percentage (0.1 - 100)
  fee: number;
  // fixed (absolute) fee
  min_fee?: bigint | undefined;
  // fixed (absolute) fee
  max_fee?: bigint | undefined;
}

export type { RoyaltyDatum, RoyaltyRecipient };
