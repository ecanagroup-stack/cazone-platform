import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

async function getFuelScope(organizationId) {
  const service = await prisma.service.findFirst({
    where: { organizationId, type: 'fuel_station' },
    select: { branches: { select: { id: true, name: true } } },
  });
  return service?.branches || [];
}

async function getCounts(organizationId, branchIds) {
  const where = { branchId: { in: branchIds } };
  const [orders, stockMoves, shifts, meterReadings, collections, deposits, dips, deliveries, legacyRecords] = await Promise.all([
    prisma.order.count({ where }),
    prisma.stockMove.count({ where }),
    prisma.shift.count({ where }),
    prisma.meterReading.count({ where }),
    prisma.fuelCollection.count({ where }),
    prisma.cashDeposit.count({ where }),
    prisma.fuelTankDip.count({ where }),
    prisma.delivery.count({ where }),
    prisma.legacyFuelRecord.count({ where: { organizationId } }),
  ]);
  return { orders, stockMoves, shifts, meterReadings, collections, deposits, dips, deliveries, legacyRecords };
}

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Only the account owner can clear fuel history' }, { status: 403 });
  const branches = await getFuelScope(session.user.organizationId);
  const counts = await getCounts(session.user.organizationId, branches.map((branch) => branch.id));
  const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { name: true } });
  return NextResponse.json({ success: true, organizationName: organization?.name, branches, counts });
}, 'fuel_station');

export const DELETE = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Only the account owner can clear fuel history' }, { status: 403 });
  try {
    const body = await request.json();
    const organizationId = session.user.organizationId;
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    if (!organization || body.confirmation !== organization.name) throw new ApiError('Type the exact business name to confirm this reset', 400);
    await verifyOtp({ userId: session.user.id, purpose: 'fuel_history_reset', code: body.otp });

    const branches = await getFuelScope(organizationId);
    const branchIds = branches.map((branch) => branch.id);
    const before = await getCounts(organizationId, branchIds);
    await prisma.$transaction(async (tx) => {
      const branchWhere = { branchId: { in: branchIds } };
      await tx.posPayment.deleteMany({ where: { meterReading: branchWhere } });
      await tx.fuelCollection.deleteMany({ where: branchWhere });
      await tx.fuelTankDip.deleteMany({ where: branchWhere });
      await tx.meterReading.deleteMany({ where: branchWhere });
      await tx.attendantAssignment.deleteMany({ where: branchWhere });
      await tx.cashDeposit.deleteMany({ where: branchWhere });
      await tx.shift.deleteMany({ where: branchWhere });
      await tx.stockMove.deleteMany({ where: branchWhere });
      await tx.order.deleteMany({ where: branchWhere });
      await tx.delivery.deleteMany({ where: branchWhere });
      await tx.reconciliation.deleteMany({ where: branchWhere });
      await tx.legacyFuelRecord.deleteMany({ where: { organizationId } });
      await tx.auditLog.create({
        data: {
          organizationId, actorUserId: session.user.id, actorName: session.user.name,
          action: 'fuelHistory.reset', entityType: 'FuelHistory', entityId: organizationId,
          before, after: { cleared: true, branchIds },
        },
      });
    }, { timeout: 30000 });
    return NextResponse.json({ success: true, cleared: before });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}, 'fuel_station');
