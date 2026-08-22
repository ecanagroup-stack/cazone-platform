import prisma from './prisma';

// core-algorithms skill §2. exposure = invoicedBalance + undeliveredOrders + thisOrder — v1 has no
// "undelivered orders" concept (materials sales are immediate, not order-then-deliver), so that
// term is always 0 here; the shape is kept so it slots in later without callers changing.
// Never hard-block: 'needsApproval' carries the exact shortfall so the UI can show it and let a
// manager/cashier override with a reason, which the caller is responsible for auditing (a Flag).
// null/undefined = unlimited credit; 0 = zero debt tolerance (strictly enforced). Mirrors
// ecana_shop-app's lib/creditLimit.js normalizeCreditLimit — keep the two in sync.
export function normalizeCreditLimit(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0 ? numeric : null;
}

export async function checkCredit({ customerId, orderTotal }) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { decision: 'blocked', reason: 'Customer not found' };
  if (customer.onHold) {
    const available = customer.creditLimit === null ? null : customer.creditLimit - customer.balance;
    return { decision: 'blocked', reason: 'Customer is on hold', exposure: customer.balance, available };
  }

  const undeliveredOrders = 0;
  const exposure = customer.balance + undeliveredOrders + orderTotal;

  if (customer.creditLimit === null) {
    return { decision: 'ok', exposure, available: null };
  }

  const available = customer.creditLimit - exposure;
  if (available < 0) {
    return { decision: 'needsApproval', exposure, available, shortfall: -available };
  }
  return { decision: 'ok', exposure, available };
}
