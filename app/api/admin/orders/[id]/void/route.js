import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Generic "delete a sale, restore stock" — ecana_shop-app's Sales History "Delete" action, ported as
// a void (never a hard delete — the record and its reason stay, matching this app's append-only
// ledger principle everywhere else) reusable by any pack's history screen, not just Cement Warehouse.
// Reverses each StockMove this order created (an offsetting 'adjustment' move, not an edit), restores
// an allocation's qtyRemaining for any line that drew from one, and reverses the customer's balance
// if this was a credit sale.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to void a sale' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required to void a sale', 400);

    const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw new ApiError('Order not found', 404);
    if (order.status === 'void') throw new ApiError('This order is already void', 400);

    const moves = await prisma.stockMove.findMany({ where: { ref: id, reason: 'sale' } });

    await prisma.$transaction(async (tx) => {
      for (const move of moves) {
        await tx.stockMove.create({
          data: { branchId: move.branchId, productId: move.productId, qty: -move.qty, reason: 'adjustment', ref: id, userId: session.user.id, note: `Void ${order.orderNumber}: ${reason}` },
        });
      }

      for (const line of order.lines) {
        if (!line.allocationId) continue;
        const move = moves.find((m) => m.productId === line.productId);
        const restoreQty = move ? -move.qty : line.qty; // the StockMove already reflects the actual (stockQty) amount taken
        const allocation = await tx.delivery.findUnique({ where: { id: line.allocationId } });
        if (!allocation) continue;
        await tx.delivery.update({
          where: { id: line.allocationId },
          data: { qtyRemaining: { increment: restoreQty }, status: allocation.status === 'closed' ? 'arrived' : allocation.status },
        });
      }

      if (order.customerId && order.paymentMethod === 'credit') {
        await tx.customer.update({ where: { id: order.customerId }, data: { balance: { decrement: order.grandTotal } } });
      }

      await tx.order.update({ where: { id }, data: { status: 'void' } });
    }, { timeout: 15000 });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'order.voided', entityType: 'Order', entityId: id, before: { status: order.status }, after: { status: 'void', reason },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
