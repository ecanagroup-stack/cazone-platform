import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { requireRecordBranch } from '@/lib/branchAccess';
import { jsonSafe } from '@/lib/jsonSafe';
import { offloadVariance, reallocateOffload } from '@/lib/fuelDelivery.mjs';

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

    const delivery = await prisma.delivery.findUnique({ where: { id }, include: { tanks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    await requireRecordBranch(session, delivery, 'Delivery not found');
    if (delivery.qtyRemaining != null) throw new ApiError('Only a received delivery can be corrected — this one is still an allocation', 400);

    const newQuantity = body.quantity !== undefined ? Number(body.quantity) : delivery.quantity;
    const newCostPerUnit = body.costPerUnit === null || body.costPerUnit === ''
      ? null
      : body.costPerUnit !== undefined ? Math.round(Number(body.costPerUnit)) : delivery.costPerUnit;
    if (!Number.isFinite(newQuantity) || newQuantity <= 0) throw new ApiError('Quantity must be a positive number', 400);
    if (newCostPerUnit != null && (!Number.isFinite(newCostPerUnit) || newCostPerUnit < 0)) throw new ApiError('Invalid cost per unit', 400);

    const quantityDelta = newQuantity - delivery.quantity;
    // A stored total (a fuel delivery's typed cost) is not rederived from the rounded per-litre rate: it is kept,
    // or rescaled with the quantity, unless the caller gives a new cost per unit.
    const keepStoredTotal = body.costPerUnit === undefined && delivery.totalCost != null;
    const newTotalCostNumber = keepStoredTotal
      ? (quantityDelta === 0 ? Number(delivery.totalCost) : Math.round(Number(delivery.totalCost) * newQuantity / delivery.quantity))
      : newCostPerUnit == null ? null : Math.round(newQuantity * newCostPerUnit);
    if (newTotalCostNumber != null && !Number.isSafeInteger(newTotalCostNumber)) throw new ApiError('Total delivery cost is too large to record safely', 400);
    const newTotalCost = newTotalCostNumber == null ? null : BigInt(newTotalCostNumber);

    // `quantity` is the ACTUAL litres received, so a fuel offload's variance against the declared load is
    // re-derived from it (a plain receipt with no declared load stays variance-free), and the per-tank
    // split moves with it: one tank takes the new figure, several need `tanks: [{ tankId, offloaded }]`.
    const newVariance = delivery.declaredLoad == null ? delivery.offloadVariance : offloadVariance(newQuantity, delivery.declaredLoad).variance;
    const tankRows = delivery.tanks.length
      ? delivery.tanks
      : delivery.tankId && delivery.openingDip != null
        ? [{ tankId: delivery.tankId, openingDip: delivery.openingDip, closingDip: delivery.closingDip, offloaded: delivery.quantity }]
        : [];
    const newTankRows = quantityDelta !== 0 ? reallocateOffload(tankRows, newQuantity, body.tanks) : tankRows;
    const firstTank = newTankRows.find((row) => row.tankId === delivery.tankId);

    const updated = await prisma.$transaction(async (tx) => {
      if (quantityDelta !== 0) {
        await tx.stockMove.create({
          data: {
            branchId: delivery.branchId, productId: delivery.productId, qty: quantityDelta,
            reason: 'adjustment', ref: delivery.id, userId: session.user.id,
            note: `Correction on delivery ${delivery.id}: ${reason}`,
          },
        });
        if (delivery.tanks.length) {
          for (const row of newTankRows) await tx.deliveryTank.update({ where: { id: row.id }, data: { offloaded: row.offloaded, closingDip: row.closingDip } });
        }
      }
      return tx.delivery.update({
        where: { id },
        data: {
          quantity: newQuantity, costPerUnit: newCostPerUnit, totalCost: newTotalCost, offloadVariance: newVariance,
          ...(quantityDelta !== 0 && firstTank ? { closingDip: firstTank.closingDip } : {}),
        },
      });
    }, { timeout: 15000 });

    const tankFigures = (rows) => rows.map((row) => ({ tankId: row.tankId, openingDip: row.openingDip, closingDip: row.closingDip, offloaded: row.offloaded }));
    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'delivery.corrected', entityType: 'Delivery', entityId: id,
      before: { quantity: delivery.quantity, costPerUnit: delivery.costPerUnit, totalCost: delivery.totalCost?.toString() ?? null, offloadVariance: delivery.offloadVariance, tanks: tankFigures(tankRows) },
      after: { quantity: newQuantity, costPerUnit: newCostPerUnit, totalCost: newTotalCost?.toString() ?? null, offloadVariance: newVariance, tanks: tankFigures(newTankRows), reason },
    });

    const shortNote = newVariance != null && newVariance < 0 ? ` It is now ${Math.abs(newVariance).toLocaleString()} L short of the declared load.` : '';
    await notifyAlteration({
      actor: session.user, branchId: delivery.branchId, type: 'delivery_corrected', title: 'Delivery corrected',
      message: `${session.user.name} corrected a delivery from ${delivery.quantity} to ${newQuantity}.${shortNote} Reason: ${reason}`,
      relatedType: 'Delivery', relatedId: id,
    });

    return NextResponse.json(jsonSafe({ success: true, data: updated }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
