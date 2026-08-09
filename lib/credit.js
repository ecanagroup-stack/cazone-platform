import prisma from './prisma';

// core-algorithms skill §2. exposure = invoicedBalance + undeliveredOrders + thisOrder — v1 has no
// "undelivered orders" concept (materials sales are immediate, not order-then-deliver), so that
// term is always 0 here; the shape is kept so it slots in later without callers changing.
// Never hard-block: 'needsApproval' carries the exact shortfall so the UI can show it and let a
// manager/cashier override with a reason, which the caller is responsible for auditing (a Flag).
export async function checkCredit({ customerId, orderTotal }) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { decision: 'blocked', reason: 'Customer not found' };
  if (customer.onHold) return { decision: 'blocked', reason: 'Customer is on hold', exposure: customer.balance, available: customer.creditLimit - customer.balance };

  const undeliveredOrders = 0;
  const exposure = customer.balance + undeliveredOrders + orderTotal;
  const available = customer.creditLimit - exposure;

  if (available < 0) {
    return { decision: 'needsApproval', exposure, available, shortfall: -available };
  }
  return { decision: 'ok', exposure, available };
}
