import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

// Ported from petrol-station-app's Backfill wizard — entering historical data for dates before an org
// subscribed to cazone, one step per call (Date & Branch -> Shift -> Pump Readings -> Deliveries ->
// Tank Dips -> Payments -> Bank Deposits), owner-only and OTP-gated (see lib/otp.js's 'backfill'
// purpose — this project moved away from the old app's hardcoded PIN entirely).
//
// Unlike the old app, backfilled StockMove entries DO count toward derived stock (the whole point of
// backfilling is an accurate historical ledger) — there's no mutable currentStock field here to
// protect the way the old app protected Station.currentStock. Every write here sets isBackfill: true
// on its parent record (Shift/Delivery/Reconciliation/CashDeposit) for real provenance, not the old
// app's free-text notes convention. A reading's Order/StockMove land already 'approved' — backfill
// has no live supervisor/cashier/manager division of labor to route through.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can enter historical data' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const type = body.type;
    const date = body.date; // YYYY-MM-DD
    if (!date) throw new ApiError('date is required', 400);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    if (dayStart >= new Date(new Date().toISOString().slice(0, 10))) throw new ApiError('Cannot backfill today or a future date', 400);

    // OTP verified once, at the step that actually creates the historical shift — an OtpCode is
    // single-use (lib/otp.js), so gating every later step in the same wizard session would break
    // after the first call. The follow-on steps (readings/payments/deliveries/dips/deposits) all
    // require that already-OTP-verified shift to exist first, which is the real gate for them.
    if (type === 'shift') {
      await verifyOtp({ userId: session.user.id, purpose: 'backfill', code: body.otp });
      return await handleShift(session, body, date, dayStart);
    }
    if (type === 'reading') {
      return await handleReading(session, body);
    }
    if (type === 'payment') {
      return await handlePayment(body);
    }
    if (type === 'delivery') {
      return await handleDelivery(session, body, dayStart);
    }
    if (type === 'dip') {
      return await handleDip(session, body, dayStart);
    }
    if (type === 'deposit') {
      return await handleDeposit(session, body, dayStart);
    }
    throw new ApiError('Invalid backfill type', 400);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

// A backfilled shift spans a real business-day window (not a zero-width instant) so a dip/deposit
// timestamped at close falls inside [openedAt, closedAt] the same way Summary Book/Reports expect a
// live shift's closing figures to.
const BACKFILL_OPEN_HOUR = '08';
const BACKFILL_CLOSE_HOUR = '20';

// The real gate for every non-shift step — proves an OTP-verified shift step already ran for this
// branch/date in this wizard session, rather than re-verifying OTP (single-use) on every call.
async function requireBackfillShift(branchId, dayStart) {
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const shift = await prisma.shift.findFirst({ where: { branchId, isBackfill: true, openedAt: { gte: dayStart, lte: dayEnd } } });
  if (!shift) throw new ApiError('Add the Shift step for this date first', 400);
  return shift;
}

async function handleShift(session, body, date, dayStart) {
  const branchId = body.branchId;
  const openingFloat = Math.round(Number(body.openingFloat) || 0);
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (assignments.length === 0) throw new ApiError('At least one pump assignment is required', 400);

  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const existing = await prisma.shift.findFirst({ where: { branchId, isBackfill: true, openedAt: { gte: dayStart, lte: dayEnd } } });
  if (existing) return NextResponse.json({ success: true, data: existing, reused: true });

  // A real business-day window, not a zero-width instant — a dip/deposit timestamped at closedAt
  // (BACKFILL_CLOSE) needs periodEnd to actually fall within [openedAt, closedAt] for Summary Book's
  // closing-stock lookup and computePeriod's receipts bucketing to find it (see BACKFILL_* below).
  const openedAt = new Date(`${date}T${BACKFILL_OPEN_HOUR}:00:00.000Z`);
  const closedAt = new Date(`${date}T${BACKFILL_CLOSE_HOUR}:00:00.000Z`);
  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: { branchId, openedBy: session.user.id, openingFloat, status: 'closed', openedAt, closedAt, isBackfill: true },
    });
    for (const a of assignments) {
      if (!a.dispenserId || !a.attendantId || !Number.isFinite(Number(a.opening))) {
        throw new ApiError('Every pump assignment needs an attendant and an opening reading', 400);
      }
      await tx.attendantAssignment.create({
        data: { branchId, dispenserId: a.dispenserId, shiftId: created.id, attendantId: a.attendantId, assignedBy: session.user.id, assignedAt: openedAt },
      });
      await tx.meterReading.create({
        data: { branchId, dispenserId: a.dispenserId, shiftId: created.id, opening: Number(a.opening), recordedBy: session.user.id },
      });
    }
    return created;
  }, { timeout: 15000 });

  return NextResponse.json({ success: true, data: shift }, { status: 201 });
}

// Combines the live app's separate submit+approve steps — backfill has no supervisor/manager
// division of labor to preserve, so the reading is entered and locked in (Order + StockMove) in one
// call, priced at whatever the admin says it was on that historical date (never today's live price).
async function handleReading(session, body) {
  const shiftId = body.shiftId;
  const dispenserId = body.dispenserId;
  const closing = Number(body.closing);
  const rtt = Number(body.rtt) || 0;
  const price = Math.round(Number(body.price)); // kobo/litre, as it was on that date
  if (!Number.isFinite(closing)) throw new ApiError('Closing reading is required', 400);
  if (!Number.isFinite(price) || price <= 0) throw new ApiError('Historical price is required', 400);

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift?.isBackfill) throw new ApiError('Not a backfill shift', 400);
  const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
  if (!reading) throw new ApiError('No opening reading found — add the shift step first', 404);
  if (closing < reading.opening) throw new ApiError('Closing reading cannot be less than the opening reading', 400);

  const litres = closing - reading.opening - rtt;
  if (litres < 0) throw new ApiError('RTT exceeds litres dispensed', 400);
  const expectedAmount = Math.round(litres * price);

  const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
  if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);
  const productId = dispenser.tank.productId;

  if (reading.orderId) {
    // Re-submitting the same reading (idempotent) — nothing new to create.
    return NextResponse.json({ success: true, data: { litres, expectedAmount, reading }, reused: true });
  }

  const result = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } },
      update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
    });
    const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;
    // A closing reading is logically taken at end of shift, not open — timestamped at closedAt so it
    // falls inside the shift's own window for anything that reads sales by date range.
    const order = await tx.order.create({
      data: {
        branchId: shift.branchId, orderNumber, subtotal: expectedAmount, grandTotal: expectedAmount,
        paymentMethod: 'cash', createdBy: session.user.id, createdAt: shift.closedAt,
        lines: { create: [{ productId, qty: litres, unitPrice: litres > 0 ? Math.round(expectedAmount / litres) : 0, lineTotal: expectedAmount }] },
      },
    });
    await tx.stockMove.create({
      data: { branchId: shift.branchId, productId, qty: -litres, reason: 'sale', ref: order.id, userId: session.user.id, at: shift.closedAt },
    });
    return tx.meterReading.update({
      where: { id: reading.id },
      data: { closing, rtt, litres, expectedAmount, orderId: order.id, reviewStatus: 'approved', reviewedBy: session.user.id, reviewedAt: shift.closedAt, recordedBy: session.user.id },
    });
  }, { timeout: 15000 });

  return NextResponse.json({ success: true, data: { litres, expectedAmount, reading: result } }, { status: 201 });
}

async function handlePayment(body) {
  const shiftId = body.shiftId;
  const dispenserId = body.dispenserId;
  const cashCollected = Math.round(Number(body.cashCollected) || 0);
  const posEntries = Array.isArray(body.posEntries) ? body.posEntries : []; // [{terminalId, amount}]
  if (cashCollected < 0) throw new ApiError('Cash collected cannot be negative', 400);

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift?.isBackfill) throw new ApiError('Not a backfill shift', 400);
  const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
  if (!reading) throw new ApiError('No reading found for this dispenser on this shift', 404);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.posPayment.deleteMany({ where: { meterReadingId: reading.id } });
    if (posEntries.length > 0) {
      await tx.posPayment.createMany({
        data: posEntries.filter((p) => p.terminalId && Number(p.amount) > 0).map((p) => ({ meterReadingId: reading.id, terminalId: p.terminalId, amount: Math.round(Number(p.amount)) })),
      });
    }
    return tx.meterReading.update({
      where: { id: reading.id }, data: { cashCollected, paymentRecordedAt: shift.closedAt },
      include: { posPayments: true },
    });
  });
  return NextResponse.json({ success: true, data: updated });
}

async function handleDelivery(session, body, dayStart) {
  const branchId = body.branchId;
  const productId = body.productId;
  const quantity = Number(body.quantity);
  const costPerUnit = Math.round(Number(body.costPerUnit));
  const supplierName = (body.supplierName || '').trim();
  if (!branchId || !productId) throw new ApiError('Branch and product are required', 400);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ApiError('Quantity must be positive', 400);
  if (!Number.isFinite(costPerUnit) || costPerUnit < 0) throw new ApiError('Invalid cost per unit', 400);
  const shift = await requireBackfillShift(branchId, dayStart);

  // Mid-day, between the shift's open and close, so it's picked up as "receipts" (not "opening")
  // by anything computing that shift's period — see BACKFILL_OPEN_HOUR/BACKFILL_CLOSE_HOUR.
  const at = new Date((shift.openedAt.getTime() + shift.closedAt.getTime()) / 2);

  const totalCost = Math.round(quantity * costPerUnit);
  const dup = await prisma.delivery.findFirst({
    where: { branchId, productId, quantity, costPerUnit, isBackfill: true, createdAt: { gte: dayStart, lte: new Date(dayStart.getTime() + 86400000) } },
  });
  if (dup) return NextResponse.json({ success: true, data: dup, reused: true });

  const { delivery } = await prisma.$transaction(async (tx) => {
    let supplierId = body.supplierId || null;
    if (!supplierId && supplierName) {
      const supplier = await tx.supplier.create({ data: { name: supplierName } });
      supplierId = supplier.id;
    }
    const created = await tx.delivery.create({
      data: { branchId, supplierId, productId, quantity, costPerUnit, totalCost, status: 'received', receivedAt: at, createdBy: session.user.id, createdAt: at, isBackfill: true },
    });
    await tx.stockMove.create({ data: { branchId, productId, qty: quantity, reason: 'purchase', ref: created.id, userId: session.user.id, at } });
    return { delivery: created };
  }, { timeout: 15000 });

  return NextResponse.json({ success: true, data: delivery }, { status: 201 });
}

async function handleDip(session, body, dayStart) {
  const branchId = body.branchId;
  const productId = body.productId;
  const measured = Number(body.measured);
  if (!branchId || !productId) throw new ApiError('Branch and product are required', 400);
  if (!Number.isFinite(measured) || measured < 0) throw new ApiError('Measured litres must be a non-negative number', 400);
  const shift = await requireBackfillShift(branchId, dayStart);

  // A closing dip is taken at end of shift — periodEnd must land inside [openedAt, closedAt] for
  // Summary Book/Reports' closing-stock lookup to find it.
  const periodEnd = shift.closedAt;

  const dup = await prisma.reconciliation.findFirst({ where: { branchId, productId, measured, isBackfill: true, periodEnd: { gte: dayStart, lte: new Date(dayStart.getTime() + 86400000) } } });
  if (dup) return NextResponse.json({ success: true, data: dup, reused: true });

  const created = await prisma.reconciliation.create({
    data: {
      branchId, productId, periodStart: shift.openedAt, periodEnd,
      opening: 0, receipts: 0, sales: 0, book: measured, measured, variance: 0, variancePct: 0, tolerance: 0,
      status: 'within_tolerance', isBackfill: true,
    },
  });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

async function handleDeposit(session, body, dayStart) {
  const branchId = body.branchId;
  const shiftId = body.shiftId || null;
  const amount = Math.round(Number(body.amount));
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Amount must be positive', 400);
  const shift = await requireBackfillShift(branchId, dayStart);

  const dup = await prisma.cashDeposit.findFirst({ where: { branchId, amount, isBackfill: true, createdAt: { gte: dayStart, lte: new Date(dayStart.getTime() + 86400000) } } });
  if (dup) return NextResponse.json({ success: true, data: dup, reused: true });

  const created = await prisma.cashDeposit.create({
    data: {
      branchId, shiftId, amount, bankName: (body.bankName || '').trim() || null, accountNumber: (body.accountNumber || '').trim() || null,
      initiatedBy: session.user.id, status: 'approved', approvedBy: session.user.id, note: body.note || null, createdAt: shift.closedAt, isBackfill: true,
    },
  });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
