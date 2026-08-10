// core-algorithms skill §3. Ageing here is keyed off Order.createdAt rather than a due date — this
// platform has no due-date/payment-terms concept yet (explicit call: don't add one this pass), so
// "oldest first" means oldest sale first, not oldest-overdue first.
//
// Allocation is a record, not arithmetic: every order it touches gets a PaymentAllocation row, so
// reversing a payment later means reversing its allocations, not recomputing a number.
export async function allocatePayment(tx, { customerId, paymentId, amount, orderIds }) {
  const openOrders = await tx.order.findMany({
    where: {
      customerId, paymentMethod: 'credit', status: 'active',
      ...(orderIds?.length ? { id: { in: orderIds } } : {}),
    },
    include: { allocations: true },
    orderBy: { createdAt: 'asc' },
  });

  let remaining = amount;
  const allocations = [];
  for (const order of openOrders) {
    if (remaining <= 0) break;
    const alreadyAllocated = order.allocations.reduce((s, a) => s + a.amount, 0);
    const outstanding = order.grandTotal - alreadyAllocated;
    if (outstanding <= 0) continue;
    const take = Math.min(outstanding, remaining);
    allocations.push(await tx.paymentAllocation.create({ data: { paymentId, orderId: order.id, amount: take } }));
    remaining -= take;
  }

  // Whatever's left is unallocated credit on the account, not lost — it's still reflected in
  // Customer.balance (decremented by the full payment amount by the caller), just not tied to any
  // specific order. It shows up on the statement as "credit on account."
  return { allocations, unallocated: remaining };
}
