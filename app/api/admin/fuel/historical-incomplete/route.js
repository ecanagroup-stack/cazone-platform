import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { verifyOtp } from '@/lib/otp';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { exactMeterSale } from '@/lib/fuelCollections.mjs';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';

// Legacy meters without a saved sale remain incomplete after import. A cashier
// can submit evidence later, but only a manager can turn it into a sale.
const loadReading = async (id) => {
  const reading = await prisma.meterReading.findUnique({ where: { id }, include: { shift: true, dispenser: true } });
  if (!reading?.legacySourceId || !reading.shift.isBackfill || reading.orderId || reading.shift.status !== 'closed')
    throw new ApiError('This is not an incomplete imported reading on a closed shift', 400);
  if (!['pending', 'historical_review'].includes(reading.reviewStatus))
    throw new ApiError('This reading has already been resolved', 409);
  return reading;
};

export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!session?.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const branchId = new URL(request.url).searchParams.get('branchId');
  if (!branchId) return NextResponse.json({ error: 'branchId is required' }, { status: 400 });
  if (!canAccessBranch(await getAccessibleBranchIds(session), branchId))
    return NextResponse.json({ error: 'Branch access denied' }, { status: 403 });
  const rows = await prisma.meterReading.findMany({
    where: { branchId, legacySourceId: { not: null }, orderId: null, reviewStatus: { in: ['pending', 'historical_review'] } },
    include: { shift: true, dispenser: true }, orderBy: { createdAt: 'desc' },
  });
  const tanks = await prisma.tank.findMany({ where: { branchId }, include: { product: true }, orderBy: { label: 'asc' } });
  return NextResponse.json({ success: true, tanks: tanks.map((tank) => ({ id: tank.id, label: tank.label,
    productId: tank.productId, product: tank.product.name })), data: rows.map((row) => ({
    id: row.id, sourceId: row.legacySourceId, operatingDate: row.shift.operatingDate,
    shiftId: row.shiftId, pump: row.dispenser.label, opening: row.opening, closing: row.closing,
    rtt: row.rtt, status: row.reviewStatus, note: row.discrepancyNote,
  })) });
}, 'fuel_station');

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!['cashier', 'manager', 'owner'].includes(session?.user?.role))
    return NextResponse.json({ error: 'Cashier access required' }, { status: 403 });
  try {
    const body = await request.json();
    const reading = await loadReading(body.readingId);
    if (!canAccessBranch(await getAccessibleBranchIds(session), reading.branchId)) throw new ApiError('Branch access denied', 403);
    const reason = String(body.reason || '').trim();
    const closing = Number(body.closing);
    const rtt = Number(body.rtt);
    if (reason.length < 10) throw new ApiError('Explain the source evidence for this correction', 400);
    if (!Number.isFinite(closing) || closing < reading.opening || !Number.isFinite(rtt) || rtt < 0 || rtt > closing - reading.opening)
      throw new ApiError('Enter a valid closing reading and return-to-tank amount', 400);
    await verifyOtp({ userId: session.user.id, purpose: 'historical_fuel_correction', code: body.otp });
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.meterReading.findUnique({ where: { id: reading.id } });
      if (current.orderId || !['pending', 'historical_review'].includes(current.reviewStatus))
        throw new ApiError('This reading was already resolved', 409);
      const saved = await tx.meterReading.update({ where: { id: reading.id }, data: {
        closing, rtt, reviewStatus: 'historical_review', discrepancyNote: reason, recordedBy: session.user.id,
      } });
      await tx.auditLog.create({ data: { organizationId: session.user.organizationId,
        actorUserId: session.user.id, actorName: session.user.name,
        action: 'legacyMeter.correctionSubmitted', entityType: 'MeterReading', entityId: reading.id,
        before: { closing: reading.closing, rtt: reading.rtt, status: reading.reviewStatus },
        after: { closing, rtt, reason, sourceId: reading.legacySourceId } } });
      return saved;
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
}, 'fuel_station');

export const PATCH = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'fuel.readings.approve'))
    return NextResponse.json({ error: 'Manager approval required' }, { status: 403 });
  try {
    const body = await request.json();
    const reading = await loadReading(body.readingId);
    if (!canAccessBranch(await getAccessibleBranchIds(session), reading.branchId)) throw new ApiError('Branch access denied', 403);
    if (reading.reviewStatus !== 'historical_review') throw new ApiError('The cashier must submit the correction first', 400);
    const reason = String(body.reason || '').trim();
    if (reason.length < 10) throw new ApiError('Explain the approval evidence', 400);
    const tank = await prisma.tank.findUnique({ where: { id: body.tankId } });
    if (!tank || tank.branchId !== reading.branchId || tank.productId !== body.productId)
      throw new ApiError('Choose a tank and its product from this branch', 400);
    const priceKobo = Math.round(Number(body.pricePerLiter) * 100);
    if (!Number.isSafeInteger(priceKobo) || priceKobo <= 0) throw new ApiError('Enter the verified historical price per litre', 400);
    const { litres, expectedAmount } = exactMeterSale({ opening: reading.opening, closing: reading.closing,
      rtt: reading.rtt, creditLitres: reading.creditLitres, priceKobo });
    if (litres <= 0) throw new ApiError('The corrected reading does not prove a positive sale', 400);
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.meterReading.updateMany({ where: { id: reading.id, orderId: null, reviewStatus: 'historical_review' },
        data: { reviewStatus: 'historical_processing' } });
      if (claim.count !== 1) throw new ApiError('This reading was already changed', 409);
      const order = await tx.order.create({ data: { branchId: reading.branchId,
        orderNumber: `LEGACY-CORRECTION-${reading.legacySourceId}`, subtotal: expectedAmount, grandTotal: expectedAmount,
        status: 'active', channel: 'fuel', createdBy: session.user.id, createdAt: reading.shift.closedAt || reading.createdAt,
        lines: { create: [{ productId: tank.productId, qty: litres, unitPrice: priceKobo, lineTotal: expectedAmount }] },
      } });
      const at = reading.shift.closedAt || reading.createdAt;
      await tx.stockMove.create({ data: { branchId: reading.branchId, productId: tank.productId,
        qty: -litres, reason: 'sale', ref: order.id, at, userId: session.user.id,
        channel: 'fuel', note: `Approved legacy meter ${reading.legacySourceId}: ${reason}` } });
      // A later correction must not move the signed physical cutover balance.
      const cutover = await tx.stockMove.findFirst({ where: { branchId: reading.branchId, productId: tank.productId,
        reason: 'stocktake', ref: { startsWith: 'signed-cutover-' }, at: { gte: at } }, orderBy: { at: 'asc' } });
      if (cutover) await tx.stockMove.create({ data: { branchId: reading.branchId, productId: tank.productId,
        qty: litres, reason: 'adjustment', ref: order.id, at: cutover.at, userId: session.user.id,
        channel: 'fuel', note: `Preserve signed cutover stock after legacy correction ${reading.id}` } });
      await tx.meterReading.update({ where: { id: reading.id }, data: { orderId: order.id,
        reviewStatus: 'approved', reviewedBy: session.user.id, reviewedAt: new Date(),
        litres, expectedAmount, productIdAtShift: tank.productId, tankIdAtShift: tank.id,
        collectionCoverage: 'unknown' } });
      await tx.auditLog.create({ data: { organizationId: session.user.organizationId,
        actorUserId: session.user.id, actorName: session.user.name,
        action: 'legacyMeter.correctionApproved', entityType: 'MeterReading', entityId: reading.id,
        before: { status: reading.reviewStatus, orderId: null },
        after: { orderId: order.id, litres, expectedAmount, tankId: tank.id,
          productId: tank.productId, priceKobo, reason, sourceId: reading.legacySourceId } } });
      return { orderId: order.id, litres, expectedAmount };
    }, { timeout: 15000 });
    return NextResponse.json({ success: true, data: result });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
}, 'fuel_station');
