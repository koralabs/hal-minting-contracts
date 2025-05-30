import { Address, InlineTxOutputDatum, TxInput } from "@helios-lang/ledger";

interface Order {
  orderTxInput: TxInput;
  // asset utf8 name
  assetsInfo: Array<[string, InlineTxOutputDatum]>;
}

interface DecodedOrder {
  orderTxInput: TxInput;
  // asset utf8 name
  assetsInfo: Array<[string, InlineTxOutputDatum]>;
  destinationAddress: Address;
  price: bigint;
  amount: number;
}

export type { DecodedOrder, Order };
