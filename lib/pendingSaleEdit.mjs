export function revisedSaleTotals(lines, discount, orderTransportFee) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const transportFee = orderTransportFee + lines.reduce((sum, line) => sum + line.transportFee, 0);
  const costs = lines.flatMap((line) => line.costs);
  const labourFee = costs.filter((cost) => cost.type === 'labour').reduce((sum, cost) => sum + cost.amount, 0);
  const otherFee = costs.filter((cost) => cost.type !== 'labour').reduce((sum, cost) => sum + cost.amount, 0);
  return { subtotal, transportFee, labourFee, otherFee, grandTotal: subtotal - discount + transportFee + labourFee + otherFee };
}

// Return the newest allocations to release when an edited invoice is lower than money already
// allocated to it. The payment stays recorded; its released amount becomes customer credit.
export function allocationReleasePlan(allocationsNewestFirst, newTotal) {
  let excess = Math.max(0, allocationsNewestFirst.reduce((sum, allocation) => sum + allocation.amount, 0) - newTotal);
  const plan = [];
  for (const allocation of allocationsNewestFirst) {
    if (excess <= 0) break;
    const release = Math.min(excess, allocation.amount);
    plan.push({ id: allocation.id, amount: allocation.amount - release });
    excess -= release;
  }
  return plan;
}

export function revisedAtcAvailability(allocation, physicalDelta) {
  if (physicalDelta > 0 && !['loaded', 'arrived'].includes(allocation.status)) {
    throw new RangeError('This ATC is no longer available for more stock');
  }
  const remaining = allocation.qtyRemaining - physicalDelta;
  if (remaining < 0) throw new RangeError(`Only ${allocation.qtyRemaining} remain on this ATC`);
  if (remaining > allocation.quantity) throw new RangeError('ATC quantity would become invalid');
  return {
    remaining,
    status: remaining === 0 ? 'closed' : allocation.status === 'closed' ? (allocation.arrivalDate ? 'arrived' : 'loaded') : allocation.status,
  };
}
