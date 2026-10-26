import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { verifyOtp } from '@/lib/otp';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { summarizePumpCollection, summarizeTankProduct, validateCollectionInput, exactMeterSale } from '@/lib/fuelCollections.mjs';
import { evaluateVariance } from '@/lib/reconciliation';
import { canAccessBranch, getAccessibleBranchIds, requireRecordBranch } from '@/lib/branchAccess';
import { jsonSafe } from '@/lib/jsonSafe';
import { logAudit } from '@/lib/audit';
import { parseBusinessDate } from '@/lib/saleDates.mjs';
import { computeBackfillDelivery, withOffloadFigures, canOffloadFuel, FUEL_VEHICLE_WHERE } from '@/lib/fuelDelivery.mjs';

const DELIVERY_STAFF = ['owner', 'manager', 'supervisor'];
const DELIVERY_INCLUDE = { supplier: true, vehicle: true, product: true, tank: true, tanks: { include: { tank: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } };

// A historical shift's saved deliveries (and the tankers a delivery can name), so the Deliveries step can
// list, edit and delete what is already recorded rather than only the forms submitted this visit.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!DELIVERY_STAFF.includes(session.user.role)) throw new ApiError('Only station managers and supervisors can enter this historical record', 403);
    const shiftId = new URL(request.url).searchParams.get('shiftId');
    if (!shiftId) throw new ApiError('shiftId is required', 400);
    const shift = await loadBackfillShift(shiftId, session);
    // Deliveries saved before they carried a shiftId belong to the shift whose window holds their time.
    const mine = { branchId: shift.branchId, isBackfill: true, OR: [{ shiftId }, { shiftId: null, createdAt: { gte: shift.openedAt, lte: shift.closedAt } }] };
    const [deliveries, vehicles] = await Promise.all([
      prisma.delivery.findMany({ where: mine, include: DELIVERY_INCLUDE, orderBy: { createdAt: 'asc' } }),
      prisma.vehicle.findMany({ where: FUEL_VEHICLE_WHERE, select: { id: true, plateNumber: true, driverName: true, driverPhone: true }, orderBy: { plateNumber: 'asc' } }),
    ]);
    return NextResponse.json(jsonSafe({ success: true, data: { deliveries: deliveries.map(withOffloadFigures), vehicles } }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

// Shared historical station entry — one step per call (Date & Branch -> Shift -> Pump Readings ->
// Deliveries -> Tank Dips -> Payments -> Bank Deposits), with OTP verification for each new shift.
//
// A historical day can have had ANY number of real shifts on it (morning/afternoon/night, or
// just one) with whatever open/close times actually happened — nothing here is a fixed window.
// Deliveries/dips/deposits always belong to one specific shift (shiftId, not "the day"), the same way
// a live branch's data does, so multiple shifts on one date never get their figures mixed together.
//
// Historical StockMove entries count toward derived stock so the ledger remains accurate. Every
// write here sets isBackfill: true
// on its parent record (Shift/Delivery/Reconciliation/CashDeposit) for real provenance, not the old
// app's free-text notes convention. A reading's Order/StockMove land already 'approved' — backfill
// has no live supervisor/cashier/manager division of labor to route through.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!['owner', 'manager', 'supervisor'].includes(session.user.role))
    return NextResponse.json({ error: 'Only owners, managers and supervisors can enter historical records' }, { status: 403 });
  try {
    const body = await request.json();
    const type = body.type;
    const date = body.date; // YYYY-MM-DD
    if (!date) throw new ApiError('date is required', 400);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    if (dayStart >= new Date(new Date().toISOString().slice(0, 10))) throw new ApiError('Cannot backfill today or a future date', 400);
    if (body.branchId && !canAccessBranch(await getAccessibleBranchIds(session), body.branchId))
      throw new ApiError('Branch access denied', 403);
    if (type === 'shift' && !['owner', 'manager', 'supervisor'].includes(session.user.role))
      throw new ApiError('Only station managers and supervisors can create historical shifts', 403);
    if (['reading', 'delivery', 'updateDelivery', 'deleteDelivery', 'dip'].includes(type) && !DELIVERY_STAFF.includes(session.user.role))
      throw new ApiError('Only station managers and supervisors can enter this historical record', 403);
    if (['payment', 'deposit'].includes(type) && !['owner', 'manager'].includes(session.user.role))
      throw new ApiError('Only station managers can enter this historical record', 403);

    // OTP verified once per shift created — an OtpCode is single-use (lib/otp.js), so each new
    // historical shift needs its own fresh code. Every other step just requires that shift to already
    // exist (checked inside each handler via shiftId), no repeated verification.
    if (type === 'shift') {
      await verifyOtp({ userId: session.user.id, purpose: 'backfill', code: body.otp });
      return await handleShift(session, body, date);
    }
    if (type === 'reading') return await handleReading(session, body);
    if (type === 'payment') return await handlePayment(session, body);
    if (type === 'delivery') return await handleDelivery(session, body);
    if (type === 'updateDelivery') return await handleUpdateDelivery(session, body);
    if (type === 'deleteDelivery') return await handleDeleteDelivery(session, body);
    if (type === 'dip') return await handleDip(session, body);
    if (type === 'deposit') return await handleDeposit(session, body);
    throw new ApiError('Invalid backfill type', 400);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

async function loadBackfillShift(shiftId, session) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  await requireRecordBranch(session, shift, 'Shift not found');
  if (!shift.isBackfill) throw new ApiError('Not a backfill shift', 400);
  return shift;
}

async function handleShift(session, body, date) {
  const branchId = body.branchId;
  const organizationId = session.user.organizationId;
  const openTime = /^\d{2}:\d{2}$/.test(body.openTime || '') ? body.openTime : '08:00';
  const closeTime = /^\d{2}:\d{2}$/.test(body.closeTime || '') ? body.closeTime : '20:00';
  const shiftLabel = (body.shiftLabel || '').trim() || null;
  const openingFloat = Math.round(Number(body.openingFloat) || 0);
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  const tankOpenings = Array.isArray(body.tankOpenings) ? body.tankOpenings : [];
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (assignments.length === 0) throw new ApiError('At least one pump assignment is required', 400);

  const openedAt = new Date(`${date}T${openTime}:00.000Z`);
  let closedAt = new Date(`${date}T${closeTime}:00.000Z`);
  if (closedAt <= openedAt) closedAt = new Date(closedAt.getTime() + 24 * 60 * 60 * 1000); // overnight shift (e.g. 20:00 -> 06:00)

  // Idempotent on the exact same (branch, openedAt) — re-submitting the identical shift (same date +
  // open time) reuses it rather than creating a duplicate; a DIFFERENT open time on the same date is
  // a genuinely different shift and gets its own row.
  const existing = await prisma.shift.findFirst({ where: { branchId, isBackfill: true, openedAt } });
  if (existing) return NextResponse.json({ success: true, data: existing, reused: true });

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const sameDayCount = await prisma.shift.count({ where: { branchId, isBackfill: true, openedAt: { gte: dayStart, lt: dayEnd } } });
  const shiftOrder = sameDayCount + 1;
  const dispensers = await prisma.dispenser.findMany({ where: { branchId, id: { in: assignments.map((assignment) => assignment.dispenserId) } }, include: { tank: true } });
  if (dispensers.length !== assignments.length || dispensers.some((dispenser) => !dispenser.tank)) {
    throw new ApiError('Every pump must be linked to a tank at this branch', 400);
  }
  const attendantIds = [...new Set(assignments.map((assignment) => assignment.attendantId).filter(Boolean))];
  if (attendantIds.length && await prisma.attendant.count({ where: { branchId, id: { in: attendantIds } } }) !== attendantIds.length) {
    throw new ApiError('Every attendant must belong to this station', 400);
  }
  const dispenserById = Object.fromEntries(dispensers.map((dispenser) => [dispenser.id, dispenser]));
  const tanks = await prisma.tank.findMany({ where: { branchId, isActive: true } });
  if (tankOpenings.length !== tanks.length || new Set(tankOpenings.map((entry) => entry.tankId)).size !== tankOpenings.length
    || tankOpenings.some((entry) => !tanks.some((tank) => tank.id === entry.tankId) || !Number.isFinite(Number(entry.measured)) || Number(entry.measured) < 0)) {
    throw new ApiError('Enter one valid opening stock reading for every active tank at this branch', 400);
  }

  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: { organizationId, branchId, openedBy: session.user.id, openingFloat, status: 'closed', openedAt, closedAt, operatingDate: date, isBackfill: true, shiftLabel, shiftOrder },
    });
    await tx.fuelTankDip.createMany({ data: tankOpenings.map((entry) => ({
      organizationId, branchId, shiftId: created.id, tankId: entry.tankId, operatingDate: date, period: 'opening',
      measured: Number(entry.measured), recordedBy: session.user.id,
    })) });
    for (const a of assignments) {
      if (!a.dispenserId || !a.attendantId || !Number.isFinite(Number(a.opening))) {
        throw new ApiError('Every pump assignment needs an attendant and an opening reading', 400);
      }
      await tx.attendantAssignment.create({
        data: { organizationId, branchId, dispenserId: a.dispenserId, shiftId: created.id, attendantId: a.attendantId, assignedBy: session.user.id, assignedAt: openedAt },
      });
      await tx.meterReading.create({
        data: { organizationId, branchId, dispenserId: a.dispenserId, shiftId: created.id, opening: Number(a.opening), recordedBy: session.user.id,
          tankIdAtShift: dispenserById[a.dispenserId].tankId, productIdAtShift: dispenserById[a.dispenserId].tank.productId },
      });
    }
    return created;
  }, { timeout: 15000 });

  await notifyAlteration({
    actor: session.user, branchId, type: 'backfill', title: 'Historical fuel shift created',
    message: `${session.user.name} used a verification code to create a historical fuel shift for ${date}.`,
    relatedType: 'Shift', relatedId: shift.id,
  });

  return NextResponse.json({ success: true, data: shift }, { status: 201 });
}

// Combines the live app's separate submit+approve steps — backfill has no supervisor/manager
// division of labor to preserve, so the reading is entered and locked in (Order + StockMove) in one
// call, priced at whatever the admin says it was on that historical date (never today's live price).
async function handleReading(session, body) {
  const organizationId = session.user.organizationId;
  const shiftId = body.shiftId;
  const dispenserId = body.dispenserId;
  const closing = Number(body.closing);
  const rtt = Number(body.rtt) || 0;
  const price = Math.round(Number(body.price)); // kobo/litre, as it was on that date
  if (!Number.isFinite(closing)) throw new ApiError('Closing reading is required', 400);
  if (!Number.isFinite(price) || price <= 0) throw new ApiError('Historical price is required', 400);

  const shift = await loadBackfillShift(shiftId, session);
  const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
  if (!reading) throw new ApiError('No opening reading found — add this pump in the Shift step first', 404);
  if (closing < reading.opening) throw new ApiError('Closing reading cannot be less than the opening reading', 400);

  let litres, expectedAmount;
  try { ({ litres, expectedAmount } = exactMeterSale({ opening: reading.opening, closing, rtt, priceKobo: price })); }
  catch (error) { throw new ApiError(error.message, 400); }

  const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
  if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);
  const productId = dispenser.tank.productId;

  if (reading.orderId) {
    // Reuse only the exact original submission. A different value needs the
    // audited correction path, not a silent successful replay.
    if (reading.closing !== closing || reading.rtt !== rtt || reading.expectedAmount !== expectedAmount) {
      throw new ApiError('This historical pump already has a different saved reading; use its correction action', 409);
    }
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
        organizationId, branchId: shift.branchId, orderNumber, subtotal: expectedAmount, grandTotal: expectedAmount,
        paymentMethod: 'cash', createdBy: session.user.id, createdAt: shift.closedAt,
        lines: { create: [{ productId, qty: litres, unitPrice: litres > 0 ? Math.round(expectedAmount / litres) : 0, lineTotal: expectedAmount }] },
      },
    });
    await tx.stockMove.create({
      data: { organizationId, branchId: shift.branchId, productId, qty: -litres, reason: 'sale', ref: order.id, userId: session.user.id, at: shift.closedAt },
    });
    return tx.meterReading.update({
      where: { id: reading.id },
      data: { closing, rtt, litres, expectedAmount, orderId: order.id, reviewStatus: 'approved', reviewedBy: session.user.id, reviewedAt: shift.closedAt, recordedBy: session.user.id },
    });
  }, { timeout: 15000 });

  return NextResponse.json({ success: true, data: { litres, expectedAmount, reading: result } }, { status: 201 });
}

async function handlePayment(session, body) {
  const shiftId = body.shiftId;
  const dispenserId = body.dispenserId;
  const cashCollected = Number(body.cashCollected);
  const posEntries = Array.isArray(body.posEntries) ? body.posEntries.map((p) => ({ terminalId: p.terminalId, amount: Number(p.amount) })) : [];
  let amounts;
  try { amounts = validateCollectionInput(cashCollected, posEntries); }
  catch (error) { throw new ApiError(error.message, 400); }

  const shift = await loadBackfillShift(shiftId, session);
  const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
  if (!reading || !(reading.litres > 0)) throw new ApiError('A positive pump sale is required before collection', 400);
  const existing = await prisma.fuelCollection.findMany({ where: { shiftId, dispenserId } });
  if (existing.length) throw new ApiError('This pump already has a backfilled collection', 409);
  const terminalIds = [...new Set(posEntries.map((p) => p.terminalId))];
  if (terminalIds.length) {
    const terminals = await prisma.posTerminal.findMany({ where: { id: { in: terminalIds }, branchId: shift.branchId } });
    if (terminals.length !== terminalIds.length) throw new ApiError('Invalid POS terminal for this branch', 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const assignment = await tx.attendantAssignment.findFirst({ where: { shiftId, dispenserId }, orderBy: { assignedAt: 'desc' } });
    await tx.fuelCollection.create({ data: {
      branchId: shift.branchId, shiftId, meterReadingId: reading.id, dispenserId,
      attendantId: assignment?.attendantId || null, operatingDate: shift.operatingDate,
      ...amounts, posEntries, expectedAmount: reading.expectedAmount,
      outstandingAfter: summarizePumpCollection(reading.expectedAmount, [{ cashAmount: amounts.cashAmount, posAmount: amounts.posAmount }]).outstanding,
      collectionType: 'initial', recordedBy: session.user.id, createdAt: shift.closedAt,
    } });
    if (posEntries.length > 0) {
      await tx.posPayment.createMany({
        data: posEntries.map((p) => ({ meterReadingId: reading.id, terminalId: p.terminalId, amount: p.amount })),
      });
    }
    return tx.meterReading.update({
      where: { id: reading.id }, data: { cashCollected, paymentRecordedAt: shift.closedAt, paymentRecordedBy: session.user.id },
      include: { posPayments: true },
    });
  });
  return NextResponse.json({ success: true, data: updated });
}

// Reads and validates one historical delivery's form: the product's receiving tank, the DECLARED load
// (waybill, optional) and the ACTUAL litres received (required; stock goes up by this, never the declared
// load), an optional cost per litre (kobo), supplier and tanker/driver. Shared by add and edit.
async function readDeliveryInput(branchId, body) {
  const productId = body.productId;
  if (!productId) throw new ApiError('Shift and product are required', 400);
  const [product, tanks] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.tank.findMany({ where: { branchId } }),
  ]);
  if (!product) throw new ApiError('Product not found', 404);

  let offload;
  try { offload = computeBackfillDelivery({ productId, tankId: body.tankId, declaredLoad: body.declaredLoad, actualLitres: body.actualLitres, branchTanks: tanks }); }
  catch (error) { throw new ApiError(error.message, 400); }

  // Optional, as in the old backfill form: a delivery with no price on the paper record is still a delivery.
  let costPerUnit = null;
  let totalCost = null;
  if (body.costPerUnit !== '' && body.costPerUnit != null) {
    costPerUnit = Math.round(Number(body.costPerUnit));
    if (!Number.isSafeInteger(costPerUnit) || costPerUnit < 0) throw new ApiError('Invalid cost per unit', 400);
    const totalCostNumber = Math.round(offload.actual * costPerUnit);
    if (!Number.isSafeInteger(totalCostNumber)) throw new ApiError('Total delivery cost is too large to record safely', 400);
    totalCost = BigInt(totalCostNumber);
  }

  // The truck and driver are optional too. A named tanker prefills the driver, which stays editable per trip.
  let vehicle = null;
  if (body.vehicleId) {
    vehicle = await prisma.vehicle.findFirst({ where: { AND: [FUEL_VEHICLE_WHERE, { id: String(body.vehicleId) }] } });
    if (!vehicle) throw new ApiError('Choose a registered tanker, or leave the truck blank', 400);
  }
  const driverName = String(body.driverName ?? vehicle?.driverName ?? '').trim() || null;
  const driverPhone = String(body.driverPhone ?? vehicle?.driverPhone ?? '').trim() || null;
  return { product, offload, costPerUnit, totalCost, vehicle, driverName, driverPhone, supplierName: String(body.supplierName || '').trim() };
}

// The supplier a delivery names: an existing one by id, or by name (reused when the business already has
// it, so typing the same supplier on every delivery does not pile up duplicates), else a new one.
async function resolveSupplier(tx, body, supplierName) {
  if (body.supplierId) {
    if (!(await tx.supplier.findFirst({ where: { id: body.supplierId } }))) throw new ApiError('Supplier not found', 400);
    return body.supplierId;
  }
  if (!supplierName) return null;
  const existing = await tx.supplier.findFirst({ where: { name: { equals: supplierName, mode: 'insensitive' } } });
  return (existing || await tx.supplier.create({ data: { name: supplierName } })).id;
}

async function handleDelivery(session, body) {
  const organizationId = session.user.organizationId;
  const shiftId = body.shiftId;
  if (!shiftId) throw new ApiError('Shift and product are required', 400);

  const shift = await loadBackfillShift(shiftId, session);
  const branchId = shift.branchId;
  // Mid-shift, between open and close, so it's picked up as "receipts" (not "opening") by anything
  // computing this specific shift's period.
  const at = new Date((shift.openedAt.getTime() + shift.closedAt.getTime()) / 2);

  const input = await readDeliveryInput(branchId, body);
  const { product, offload, vehicle } = input;

  // The same load (shift, product, tank, litres) submitted twice is almost certainly a double click or a
  // re-sent form, so the saved one comes back instead of a second record. Two different loads differ in tank or litres.
  const dup = await prisma.delivery.findFirst({
    where: { branchId, shiftId, productId: product.id, tankId: offload.tank.tankId, quantity: offload.actual, isBackfill: true },
    include: DELIVERY_INCLUDE,
  });
  if (dup) return NextResponse.json(jsonSafe({ success: true, data: withOffloadFigures(dup), reused: true }));

  const delivery = await prisma.$transaction(async (tx) => {
    const supplierId = await resolveSupplier(tx, body, input.supplierName);
    const created = await tx.delivery.create({
      data: {
        organizationId, branchId, supplierId, vehicleId: vehicle?.id ?? null, productId: product.id,
        quantity: offload.actual, costPerUnit: input.costPerUnit, totalCost: input.totalCost,
        status: 'received', receivedAt: at, createdBy: session.user.id, createdAt: at, isBackfill: true,
        shiftId, businessDate: shift.operatingDate ? parseBusinessDate(shift.operatingDate, 'Shift date') : null,
        driverName: input.driverName, driverPhone: input.driverPhone,
        // Only a declared load makes this a delivery with a variance; without one it stays a plain receipt.
        declaredLoad: offload.declaredLoad, offloadVariance: offload.variance,
        tankId: offload.tank.tankId,
      },
    });
    await tx.deliveryTank.create({ data: { organizationId, deliveryId: created.id, tankId: offload.tank.tankId, openingDip: null, closingDip: null, offloaded: offload.actual } });
    await tx.stockMove.create({ data: { organizationId, branchId, productId: product.id, qty: offload.actual, reason: 'purchase', ref: created.id, userId: session.user.id, at } });
    return tx.delivery.findUnique({ where: { id: created.id }, include: DELIVERY_INCLUDE });
  }, { timeout: 15000 });

  await logAudit({
    organizationId, actorUserId: session.user.id, actorName: session.user.name,
    action: 'fuel.delivery.backfilled', entityType: 'Delivery', entityId: delivery.id,
    after: {
      branchId, shiftId, operatingDate: shift.operatingDate, product: product.name, tank: offload.tank.tankLabel, truck: vehicle?.plateNumber ?? null,
      declaredLoad: offload.declaredLoad, actual: offload.actual, offloadVariance: offload.variance,
    },
  });
  if (offload.shortage > 0) {
    await notifyAlteration({
      actor: session.user, branchId, type: 'delivery_shortage', title: 'Fuel delivery came in short',
      message: `${session.user.name} recorded a historical delivery for ${shift.operatingDate}: ${offload.actual.toLocaleString()} L of ${product.name} received${vehicle ? ` from truck ${vehicle.plateNumber}` : ''}, ${offload.shortage.toLocaleString()} L short of the ${offload.declaredLoad.toLocaleString()} L declared.`,
      relatedType: 'Delivery', relatedId: delivery.id,
    });
  }

  return NextResponse.json(jsonSafe({ success: true, data: withOffloadFigures(delivery) }), { status: 201 });
}

// Loads a saved historical delivery for an edit or delete. The branch comes from the delivery itself (never
// from the request), and only a delivery entered through Historical Entries can be changed here: a live one
// goes through the audited correction on the Truck Offload page.
async function loadBackfillDelivery(session, deliveryId) {
  if (!canOffloadFuel(session.user.role)) throw new ApiError('Only an owner or manager can change a historical fuel delivery', 403);
  if (!deliveryId) throw new ApiError('deliveryId is required', 400);
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: { product: true } });
  await requireRecordBranch(session, delivery, 'Delivery not found');
  if (!delivery.isBackfill) throw new ApiError('Only a historical delivery can be changed here', 400);
  return delivery;
}

const deliverySnapshot = (delivery) => ({
  productId: delivery.productId, tankId: delivery.tankId, quantity: delivery.quantity, declaredLoad: delivery.declaredLoad,
  offloadVariance: delivery.offloadVariance, costPerUnit: delivery.costPerUnit, totalCost: delivery.totalCost?.toString() ?? null,
  supplierId: delivery.supplierId, vehicleId: delivery.vehicleId, driverName: delivery.driverName, driverPhone: delivery.driverPhone,
});

// The offsetting entries for a historical delivery's stock are dated where the original receipt sits (inside
// its shift), so stock as of any date, and the shifts after it, still add up. Nothing in the ledger is edited.
async function deliveryReceiptTime(tx, delivery) {
  const receipt = await tx.stockMove.findFirst({ where: { ref: delivery.id, reason: 'purchase' }, orderBy: { at: 'asc' } });
  return receipt?.at || delivery.createdAt;
}

async function handleUpdateDelivery(session, body) {
  const delivery = await loadBackfillDelivery(session, body.deliveryId);
  const organizationId = session.user.organizationId;
  const branchId = delivery.branchId;

  const input = await readDeliveryInput(branchId, body);
  const { product, offload, vehicle } = input;

  const updated = await prisma.$transaction(async (tx) => {
    const at = await deliveryReceiptTime(tx, delivery);
    const note = `Edit of historical delivery ${delivery.id}`;
    const move = (productId, qty) => tx.stockMove.create({ data: { organizationId, branchId, productId, qty, reason: 'adjustment', ref: delivery.id, userId: session.user.id, note, at } });
    if (product.id !== delivery.productId) {
      await move(delivery.productId, -delivery.quantity);
      await move(product.id, offload.actual);
    } else if (offload.actual !== delivery.quantity) {
      await move(product.id, offload.actual - delivery.quantity);
    }

    const supplierId = await resolveSupplier(tx, body, input.supplierName);
    await tx.deliveryTank.deleteMany({ where: { deliveryId: delivery.id } });
    await tx.deliveryTank.create({ data: { organizationId, deliveryId: delivery.id, tankId: offload.tank.tankId, openingDip: null, closingDip: null, offloaded: offload.actual } });
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        productId: product.id, tankId: offload.tank.tankId, quantity: offload.actual, costPerUnit: input.costPerUnit, totalCost: input.totalCost,
        supplierId, vehicleId: vehicle?.id ?? null, driverName: input.driverName, driverPhone: input.driverPhone,
        declaredLoad: offload.declaredLoad, offloadVariance: offload.variance, openingDip: null, closingDip: null,
      },
    });
    return tx.delivery.findUnique({ where: { id: delivery.id }, include: DELIVERY_INCLUDE });
  }, { timeout: 15000 });

  await logAudit({
    organizationId, actorUserId: session.user.id, actorName: session.user.name,
    action: 'fuel.delivery.backfill_edited', entityType: 'Delivery', entityId: delivery.id,
    before: deliverySnapshot(delivery), after: deliverySnapshot(updated),
  });
  const shortNote = offload.shortage > 0 ? ` It is now ${offload.shortage.toLocaleString()} L short of the ${offload.declaredLoad.toLocaleString()} L declared.` : '';
  await notifyAlteration({
    actor: session.user, branchId, type: offload.shortage > 0 ? 'delivery_shortage' : 'delivery_corrected', title: 'Historical fuel delivery edited',
    message: `${session.user.name} edited a historical delivery of ${delivery.product.name} from ${delivery.quantity.toLocaleString()} L to ${offload.actual.toLocaleString()} L received.${shortNote}`,
    relatedType: 'Delivery', relatedId: delivery.id,
  });

  return NextResponse.json(jsonSafe({ success: true, data: withOffloadFigures(updated) }));
}

async function handleDeleteDelivery(session, body) {
  const delivery = await loadBackfillDelivery(session, body.deliveryId);
  const organizationId = session.user.organizationId;
  const branchId = delivery.branchId;

  await prisma.$transaction(async (tx) => {
    const at = await deliveryReceiptTime(tx, delivery);
    // The litres come back out of stock through an offsetting entry; the original receipt stays in the ledger.
    await tx.stockMove.create({
      data: { organizationId, branchId, productId: delivery.productId, qty: -delivery.quantity, reason: 'adjustment', ref: delivery.id, userId: session.user.id, note: `Deleted historical delivery ${delivery.id}`, at },
    });
    await tx.delivery.delete({ where: { id: delivery.id } });
  }, { timeout: 15000 });

  await logAudit({
    organizationId, actorUserId: session.user.id, actorName: session.user.name,
    action: 'fuel.delivery.backfill_deleted', entityType: 'Delivery', entityId: delivery.id,
    before: { ...deliverySnapshot(delivery), shiftId: delivery.shiftId },
  });
  await notifyAlteration({
    actor: session.user, branchId, type: 'delivery_corrected', title: 'Historical fuel delivery deleted',
    message: `${session.user.name} deleted a historical delivery of ${delivery.quantity.toLocaleString()} L of ${delivery.product.name}.`,
    relatedType: 'Delivery', relatedId: delivery.id,
  });

  return NextResponse.json({ success: true, data: { deleted: true } });
}

async function handleDip(session, body) {
  const organizationId = session.user.organizationId;
  const shiftId = body.shiftId;
  const tankId = body.tankId;
  const measured = Number(body.measured);
  if (!shiftId || !tankId) throw new ApiError('Shift and tank are required', 400);
  if (!Number.isFinite(measured) || measured < 0) throw new ApiError('Measured litres must be a non-negative number', 400);

  const shift = await loadBackfillShift(shiftId, session);
  const branchId = shift.branchId;
  const tank = await prisma.tank.findUnique({ where: { id: tankId } });
  if (!tank || tank.branchId !== branchId) throw new ApiError('Tank does not belong to this branch', 400);
  const productId = tank.productId;
  // A closing dip is taken at end of shift — periodEnd must land inside [openedAt, closedAt] for
  // Summary Book/Reports' closing-stock lookup to find it.
  const periodEnd = shift.closedAt;

  const result = await prisma.$transaction(async (tx) => {
    const dup = await tx.fuelTankDip.findUnique({ where: { shiftId_tankId_period: { shiftId, tankId, period: 'closing' } } });
    if (dup) return { dip: dup, reused: true };
    const dip = await tx.fuelTankDip.create({ data: {
      organizationId, branchId, shiftId, tankId, operatingDate: shift.operatingDate, period: 'closing', measured,
      recordedBy: session.user.id, createdAt: periodEnd,
    } });
    const tanks = await tx.tank.findMany({ where: { branchId, productId, isActive: true } });
    const dips = await tx.fuelTankDip.findMany({ where: { shiftId, period: 'closing', tankId: { in: tanks.map((item) => item.id) } } });
    if (tanks.length && dips.length === tanks.length) {
      const existing = await tx.reconciliation.findFirst({ where: { branchId, productId, isBackfill: true, periodEnd } });
      if (!existing) {
        const [readings, purchases, openingDips, openingStock, branch] = await Promise.all([
          tx.meterReading.findMany({ where: { shiftId }, include: { dispenser: { include: { tank: true } } } }),
          tx.stockMove.findMany({ where: { branchId, productId, reason: 'purchase', at: { gte: shift.openedAt, lte: periodEnd } } }),
          tx.fuelTankDip.findMany({ where: { shiftId, period: 'opening', tank: { productId } }, select: { measured: true } }),
          tx.stockMove.aggregate({ where: { branchId, productId, at: { lt: shift.openedAt } }, _sum: { qty: true } }),
          tx.branch.findUnique({ where: { id: branchId } }),
        ]);
        const { opening, receipts, sales, book, measured: totalMeasured } = summarizeTankProduct(
          productId, tanks, openingDips, dips, readings, purchases, openingDips.length
            ? openingDips.reduce((sum, dip) => sum + dip.measured, 0)
            : openingStock._sum.qty || 0,
        );
        const tolerance = Number(branch?.config?.reconciliationTolerancePct) || 0.5;
        const { variance, variancePct, status } = evaluateVariance(book, totalMeasured, receipts, tolerance);
        await tx.reconciliation.create({ data: {
          organizationId, branchId, productId, periodStart: shift.openedAt, periodEnd,
          opening, receipts, sales, book, measured: totalMeasured,
          variance, variancePct, tolerance, status, isBackfill: true,
        } });
      }
    }
    return { dip, reused: false };
  }, { timeout: 30000 });
  return NextResponse.json({ success: true, data: result.dip, reused: result.reused }, { status: result.reused ? 200 : 201 });
}

async function handleDeposit(session, body) {
  const shiftId = body.shiftId;
  const amount = Math.round(Number(body.amount));
  if (!shiftId) throw new ApiError('shiftId is required', 400);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Amount must be positive', 400);

  const shift = await loadBackfillShift(shiftId, session);
  const branchId = shift.branchId;

  const dup = await prisma.cashDeposit.findFirst({ where: { branchId, shiftId, amount, isBackfill: true } });
  if (dup) return NextResponse.json({ success: true, data: dup, reused: true });

  const created = await prisma.cashDeposit.create({
    data: {
      branchId, shiftId, operatingDate: shift.operatingDate, amount, bankName: (body.bankName || '').trim() || null, accountNumber: (body.accountNumber || '').trim() || null,
      initiatedBy: session.user.id, status: 'approved', approvedBy: session.user.id, note: body.note || null, createdAt: shift.closedAt, isBackfill: true,
    },
  });
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
