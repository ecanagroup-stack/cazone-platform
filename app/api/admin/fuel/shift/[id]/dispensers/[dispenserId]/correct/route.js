import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Fix a mistake in an already-approved pump reading — petrol-station-app's Reports day-detail
// correction, generalized from the one existing precedent in this codebase
// (app/api/admin/deliveries/[id]/correct/route.js): reason required, the record is adjusted in
// place rather than voided/recreated, and any stock-ledger impact is an offsetting StockMove, never
// a silent overwrite. Gated at the same tier that approves in the first place — a correction is a
// stronger action than approval, never a lesser one.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'fuel.readings.approve')) {
    return NextResponse.json({ error: 'You do not have permission to correct a pump reading' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required to correct a reading', 400);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('Reading not found', 404);
    if (reading.reviewStatus !== 'approved') throw new ApiError('Only an approved reading can be corrected this way', 400);

    const changingLitres = body.closing !== undefined || body.rtt !== undefined;
    const newCashCollected = body.cashCollected !== undefined && body.cashCollected !== ''
      ? Math.round(Number(body.cashCollected))
      : reading.cashCollected;

    if (!changingLitres) {
      // Payment-only correction — no stock/order impact, cash collected was never part of the ledger.
      const updated = await prisma.meterReading.update({ where: { id: reading.id }, data: { cashCollected: newCashCollected } });
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'meterReading.corrected', entityType: 'MeterReading', entityId: reading.id,
        before: { cashCollected: reading.cashCollected }, after: { cashCollected: newCashCollected, reason },
      });
      return NextResponse.json({ success: true, data: { reading: updated } });
    }

    const newClosing = body.closing !== undefined ? Number(body.closing) : reading.closing;
    const newRtt = body.rtt !== undefined ? Number(body.rtt) : reading.rtt;
    if (!Number.isFinite(newClosing) || newClosing < reading.opening) throw new ApiError('Closing reading cannot be less than the opening reading', 400);
    const newLitres = newClosing - reading.opening - newRtt - reading.creditLitres;
    if (newLitres < 0) throw new ApiError('Recorded credit fills exceed the total litres dispensed', 400);

    if (!reading.orderId) throw new ApiError('This reading has no linked sale to correct', 400);
    const order = await prisma.order.findUnique({ where: { id: reading.orderId }, include: { lines: true } });
    if (!order) throw new ApiError('Linked order not found', 404);
    const line = order.lines[0];
    // The price actually charged at approval time, never today's price — an old sale reprices
    // identically forever (core-algorithms skill §1), a correction only changes the quantity.
    const unitPrice = line.unitPrice;
    const newExpectedAmount = Math.round(newLitres * unitPrice);
    const litresDelta = newLitres - reading.litres;

    const result = await prisma.$transaction(async (tx) => {
      if (litresDelta !== 0) {
        await tx.orderLine.update({ where: { id: line.id }, data: { qty: newLitres, lineTotal: newExpectedAmount } });
        await tx.order.update({ where: { id: order.id }, data: { subtotal: newExpectedAmount, grandTotal: newExpectedAmount } });
        await tx.stockMove.create({
          data: {
            branchId: reading.branchId, productId: line.productId, qty: -litresDelta, reason: 'adjustment', ref: order.id,
            userId: session.user.id, note: `Correction on reading ${reading.id}: ${reason}`,
          },
        });
      }
      return tx.meterReading.update({
        where: { id: reading.id },
        data: { closing: newClosing, rtt: newRtt, litres: newLitres, expectedAmount: newExpectedAmount, cashCollected: newCashCollected },
      });
    }, { timeout: 15000 });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'meterReading.corrected', entityType: 'MeterReading', entityId: reading.id,
      before: { closing: reading.closing, rtt: reading.rtt, litres: reading.litres, expectedAmount: reading.expectedAmount, cashCollected: reading.cashCollected },
      after: { closing: newClosing, rtt: newRtt, litres: newLitres, expectedAmount: newExpectedAmount, cashCollected: newCashCollected, reason },
    });

    return NextResponse.json({ success: true, data: { reading: result } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
