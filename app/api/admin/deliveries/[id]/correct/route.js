import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Correcting a delivery's recorded quantity/cost after receipt — the one Day Detail correction
// (Part 3) with no existing audited path to reuse (a wrong meter reading gets queried/resubmitted;
// a wrong deposit gets rejected). Follows app/api/admin/orders/[id]/void/route.js's shape: the stock
// effect of the correction is an offsetting StockMove (reason 'adjustment'), never a silent ledger
// edit, while Delivery's own quantity/cost fields — the record of what was actually delivered, same
// as Order.grandTotal isn't rederived — update to the corrected figures, with a full before/after
// logged via logAudit. Only valid for a 'received' delivery (on-hand stock already moved); an
// allocation not yet received has no stock effect to correct yet.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'stock.receive')) {
    return NextResponse.json({ error: 'You do not have permission to correct a delivery' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required to correct a delivery', 400);

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) throw new ApiError('Delivery not found', 404);
    if (delivery.qtyRemaining != null) throw new ApiError('Only a received delivery can be corrected — this one is still an allocation', 400);

    const newQuantity = body.quantity !== undefined ? Number(body.quantity) : delivery.quantity;
    const newCostPerUnit = body.costPerUnit !== undefined ? Math.round(Number(body.costPerUnit)) : delivery.costPerUnit;
    if (!Number.isFinite(newQuantity) || newQuantity <= 0) throw new ApiError('Quantity must be a positive number', 400);
    if (!Number.isFinite(newCostPerUnit) || newCostPerUnit < 0) throw new ApiError('Invalid cost per unit', 400);

    const quantityDelta = newQuantity - delivery.quantity;
    const newTotalCost = Math.round(newQuantity * newCostPerUnit);

    const updated = await prisma.$transaction(async (tx) => {
      if (quantityDelta !== 0) {
        await tx.stockMove.create({
          data: {
            branchId: delivery.branchId, productId: delivery.productId, qty: quantityDelta,
            reason: 'adjustment', ref: delivery.id, userId: session.user.id,
            note: `Correction on delivery ${delivery.id}: ${reason}`,
          },
        });
      }
      return tx.delivery.update({
        where: { id }, data: { quantity: newQuantity, costPerUnit: newCostPerUnit, totalCost: newTotalCost },
      });
    }, { timeout: 15000 });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'delivery.corrected', entityType: 'Delivery', entityId: id,
      before: { quantity: delivery.quantity, costPerUnit: delivery.costPerUnit, totalCost: delivery.totalCost },
      after: { quantity: newQuantity, costPerUnit: newCostPerUnit, totalCost: newTotalCost, reason },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
