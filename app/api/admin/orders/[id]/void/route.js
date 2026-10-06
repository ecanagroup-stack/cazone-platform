import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';

// A bounded correction for unpaid ordinary shop credit sales. Other sale types need a
// dedicated payment or allocation reversal before their stock and balance can change.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!['owner', 'manager', 'materials_manager'].includes(session?.user?.role)) {
    return NextResponse.json({ error: 'You do not have permission to void a sale' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required to void a sale', 400);

    const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw new ApiError('Order not found', 404);
    const branchIds = await getAccessibleBranchIds(session);
    if (!canAccessBranch(branchIds, order.branchId)) throw new ApiError('Order not found', 404);
    if (order.status !== 'active' || order.channel !== 'shop' || order.paymentMethod !== 'credit' || !order.customerId) {
      throw new ApiError('Only active shop credit sales can be voided here', 409);
    }
    if (order.lines.some((line) => line.allocationId)) throw new ApiError('Allocation sales need a separate stock correction', 409);

    const moves = await prisma.stockMove.findMany({ where: { ref: id, reason: 'sale' } });
    if (moves.length !== order.lines.length) throw new ApiError('Sale stock movements are incomplete; use a supervised correction', 409);

    await prisma.$transaction(async (tx) => {
      const [payments, adjustments] = await Promise.all([
        tx.paymentAllocation.count({ where: { orderId: id } }),
        tx.customerAdjustment.count({ where: { orderId: id } }),
      ]);
      if (payments || adjustments) throw new ApiError('This sale has payments or adjustments; use a supervised correction', 409);
      const changed = await tx.order.updateMany({ where: { id, status: 'active' }, data: { status: 'void' } });
      if (changed.count !== 1) throw new ApiError('This sale has already changed', 409);
      for (const move of moves) {
        await tx.stockMove.create({
          data: { branchId: move.branchId, productId: move.productId, qty: -move.qty, reason: 'adjustment', ref: id, userId: session.user.id, note: `Void ${order.orderNumber}: ${reason}` },
        });
      }

      await tx.customer.update({ where: { id: order.customerId }, data: { balance: { decrement: order.grandTotal } } });
    }, { timeout: 15000 });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'order.voided', entityType: 'Order', entityId: id, before: { status: order.status }, after: { status: 'void', reason },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}, 'shop');
