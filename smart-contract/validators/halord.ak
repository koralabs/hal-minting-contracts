use aiken/transaction.{ScriptContext, Spend}
use aiken/transaction/value.{PolicyId}
use validations/orders_spend/validation.{
  can_cancel_order, can_execute_orders, can_refund_order,
}

type OrderSpendRedeemer {
  ExecuteOrders
  CancelOrder
  RefundOrder
}

// This is Spending validator
// Where Order UTxO is sent
// with OrderDatum and enough lovelace to pay
//
// ===== Parameters =====
// `hal_policy_id`: Policy id of HAL NFT
// `randomizer`: Random bytearray to make validator hash random
//
validator(hal_policy_id: PolicyId, _randomizer: ByteArray) {
  fn spend(
    datum: Data,
    redeemer: OrderSpendRedeemer,
    ctx: ScriptContext,
  ) -> Bool {
    let ScriptContext(transaction, purpose) = ctx
    expect Spend(spending_output_reference) = purpose

    when redeemer is {
      ExecuteOrders -> can_execute_orders(transaction, hal_policy_id)
      CancelOrder ->
        can_cancel_order(transaction, datum, spending_output_reference)
      RefundOrder ->
        can_refund_order(transaction, datum, spending_output_reference)
    }
  }
}
