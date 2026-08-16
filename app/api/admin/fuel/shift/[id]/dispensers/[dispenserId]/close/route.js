import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Closing a dispenser's meter reading for the shift IS the sale — litres = closing - opening - rtt,
// priced at whatever PriceRule is currently open-ended for the tank's product. Creates one
// Order+OrderLine (core credit/AR + reporting model) and one StockMove (the ledger), and links the
// Order back onto the MeterReading so shift-end cash-up can sum exactly this shift's sales.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const closing = Number(body.closing);
    const rtt = Number(body.rtt) || 0;
    if (!Number.isFinite(closing)) throw new ApiError('Closing reading is required', 400);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('No opening reading found for this dispenser on this shift', 404);
    if (reading.closing != null) throw new ApiError('This dispenser has already been closed for this shift', 400);
    if (closing < reading.opening) throw new ApiError('Closing reading cannot be less than the opening reading', 400);

    // Litres already sold to named credit customers this shift (see credit-fill route) are excluded
    // from this aggregate cash sale — they were already invoiced individually.
    const litres = closing - reading.opening - rtt - reading.creditLitres;
    if (litres < 0) throw new ApiError('Recorded credit fills exceed the total litres dispensed — check the credit fills for this pump', 400);

    const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
    if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);
    const productId = dispenser.tank.productId;

    const priceRule = await prisma.priceRule.findFirst({ where: { productId, validTo: null }, orderBy: { validFrom: 'desc' } });
    if (!priceRule) throw new ApiError('No price is set for this product — set one from Begin Shift', 400);

    const lineTotal = Math.round(litres * priceRule.price);

    const order = await prisma.$transaction(async (tx) => {
      await tx.meterReading.update({ where: { id: reading.id }, data: { closing, rtt, recordedBy: session.user.id } });

      const counterKey = { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } };
      const counter = await tx.counter.upsert({
        where: counterKey, update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
      });
      const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

      const created = await tx.order.create({
        data: {
          branchId: shift.branchId, orderNumber, subtotal: lineTotal, grandTotal: lineTotal,
          paymentMethod: 'cash', createdBy: session.user.id,
          lines: { create: [{ productId, priceRuleId: priceRule.id, qty: litres, unitPrice: priceRule.price, lineTotal }] },
        },
        include: { lines: true },
      });

      await tx.stockMove.create({
        data: { branchId: shift.branchId, productId, qty: -litres, reason: 'sale', ref: created.id, userId: session.user.id },
      });

      await tx.meterReading.update({ where: { id: reading.id }, data: { orderId: created.id } });

      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: { litres, order } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
