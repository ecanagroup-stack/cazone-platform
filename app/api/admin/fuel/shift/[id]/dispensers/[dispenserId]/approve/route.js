import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// The manager's half of D5's review chain — the only step that actually creates the Order/StockMove.
// Sees the supervisor's reading and the cashier's payment side by side (both already recorded, this
// just decides). Approving locks in the sale; querying sends it back with a note for either of them
// to correct and resubmit, no financial effect either way until approved.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'fuel.readings.approve')) {
    return NextResponse.json({ error: 'You do not have permission to approve pump readings' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const decision = body.decision; // 'approve' | 'query'
    const note = (body.note || '').trim();
    if (!['approve', 'query'].includes(decision)) throw new ApiError('Invalid decision', 400);
    if (decision === 'query' && !note) throw new ApiError('A note is required when querying a submission', 400);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('No reading found for this dispenser on this shift', 404);
    if (reading.closing == null) throw new ApiError('The pump reading has not been submitted yet', 400);
    if (reading.reviewStatus === 'approved') throw new ApiError('This pump has already been approved', 400);

    if (decision === 'query') {
      const updated = await prisma.meterReading.update({
        where: { id: reading.id },
        data: { reviewStatus: 'queried', reviewedBy: session.user.id, reviewedAt: new Date(), discrepancyNote: note },
      });
      return NextResponse.json({ success: true, data: { reading: updated } });
    }

    const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
    if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);
    const productId = dispenser.tank.productId;

    const result = await prisma.$transaction(async (tx) => {
      const counterKey = { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } };
      const counter = await tx.counter.upsert({
        where: counterKey, update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
      });
      const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

      const order = await tx.order.create({
        data: {
          branchId: shift.branchId, orderNumber, subtotal: reading.expectedAmount, grandTotal: reading.expectedAmount,
          paymentMethod: 'cash', createdBy: session.user.id,
          lines: { create: [{ productId, qty: reading.litres, unitPrice: reading.litres > 0 ? Math.round(reading.expectedAmount / reading.litres) : 0, lineTotal: reading.expectedAmount }] },
        },
        include: { lines: true },
      });

      await tx.stockMove.create({
        data: { branchId: shift.branchId, productId, qty: -reading.litres, reason: 'sale', ref: order.id, userId: session.user.id },
      });

      const updatedReading = await tx.meterReading.update({
        where: { id: reading.id },
        data: { orderId: order.id, reviewStatus: 'approved', reviewedBy: session.user.id, reviewedAt: new Date() },
      });

      return { order, reading: updatedReading };
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
