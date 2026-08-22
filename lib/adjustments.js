import prisma from './prisma';
import { logAudit } from './audit';

// Applies a manual balance move — surcharge (adds debt, balance up) or refund/fund (reduces debt,
// balance down) — and records it as a CustomerAdjustment row. Ported from ecana_shop-app's
// standalone (app/api/customers/[id]/surcharge|refund) and sale-tied
// (app/api/sales/[id]/surcharge|refund) adjustment routes, flattened into one function since Prisma
// has no embedded-array equivalent of Sale.adjustments — orderId just stays null for a standalone one.
export async function applyAdjustment({ session, customerId, orderId, type, method, amount, reason }) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error('Customer not found');

    const balanceBefore = customer.balance;
    const delta = type === 'surcharge' ? amount : -amount;
    const updated = await tx.customer.update({ where: { id: customerId }, data: { balance: { increment: delta } } });
    const balanceAfter = updated.balance;

    const adjustment = await tx.customerAdjustment.create({
      data: {
        customerId, orderId: orderId || null, type, method: method || null, amount, reason: reason || null,
        balanceBefore, balanceAfter, createdBy: session.user.id,
      },
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: orderId ? `${type}_applied` : `${type}_applied_standalone`,
      entityType: 'CustomerAdjustment', entityId: adjustment.id,
      after: { customerId, orderId: orderId || null, type, method: method || null, amount, reason, balanceBefore, balanceAfter },
    });

    return adjustment;
  }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default
}
