import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runUnscoped, runWithOrg } from '@/lib/tenantScope';
import { notify } from '@/lib/notify';
import { operatingDateAt, overdueShiftBlockers } from '@/lib/fuelCollections.mjs';
import { createShiftTankReconciliations } from '@/lib/fuelTankReconciliation';

export const dynamic = 'force-dynamic';

// Vercel calls this at 11:00 UTC (noon in Lagos). Incomplete shifts remain open.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 12) return NextResponse.json({ checked: 0, message: 'Noon in Lagos has not passed' });
  const today = operatingDateAt(now);
  const overdue = await runUnscoped(() => prisma.shift.findMany({
    where: { status: 'open', operatingDate: { lt: today }, branch: { service: { type: 'fuel_station' } } },
    select: { id: true, organizationId: true },
  }));
  const results = [];
  for (const candidate of overdue) {
    try {
      const result = await runWithOrg(candidate.organizationId, async () => {
        const shift = await prisma.shift.findUnique({ where: { id: candidate.id } });
        if (!shift || shift.status !== 'open') return { id: candidate.id, status: 'already_closed' };
        const [readings, tanks, dips, openingDips, collections, branch] = await Promise.all([
          prisma.meterReading.findMany({ where: { shiftId: shift.id }, include: { dispenser: { include: { tank: true } } } }),
          prisma.tank.findMany({ where: { branchId: shift.branchId, isActive: true } }),
          prisma.fuelTankDip.findMany({ where: { shiftId: shift.id, period: 'closing' } }),
          prisma.fuelTankDip.findMany({ where: { shiftId: shift.id, period: 'opening' } }),
          prisma.fuelCollection.findMany({ where: { shiftId: shift.id } }),
          prisma.branch.findUnique({ where: { id: shift.branchId } }),
        ]);
        const blockers = overdueShiftBlockers(readings, tanks, dips, collections);
        if (blockers.length) {
          const existingNotice = await prisma.notification.findFirst({ where: {
            relatedType: 'Shift', relatedId: shift.id, title: 'Overdue fuel shift needs completion',
          } });
          if (!existingNotice) await notify({ recipientRole: 'manager', type: 'flag_raised',
            title: 'Overdue fuel shift needs completion', relatedType: 'Shift', relatedId: shift.id,
            message: `${shift.operatingDate}: ${blockers.join('; ')}.` });
          return { id: shift.id, status: 'blocked', blockers };
        }
        const active = collections.filter((collection) => !collection.voidedAt);
        const expectedCash = shift.openingFloat + active.reduce((sum, collection) => sum + collection.cashAmount, 0);
        return prisma.$transaction(async (tx) => {
          const current = await tx.shift.findUnique({ where: { id: shift.id } });
          if (current?.status !== 'open') return { id: shift.id, status: 'already_closed' };
          await createShiftTankReconciliations(tx, { shift, readings, tanks, openingDips, closingDips: dips, branch, actorId: 'system', periodEnd: now });
          await tx.shift.update({ where: { id: shift.id }, data: {
            status: 'closed', closedAt: now, expectedCash,
            note: 'System auto-close after complete pump, collection and tank records; physical cash count was not entered.',
          } });
          await tx.auditLog.create({ data: {
            actorUserId: 'system', actorName: 'System auto-close', action: 'fuel.shift.auto_closed',
            entityType: 'Shift', entityId: shift.id, after: { expectedCash, operatingDate: shift.operatingDate },
          } });
          return { id: shift.id, status: 'closed' };
        }, { isolationLevel: 'Serializable', timeout: 30000 });
      });
      results.push(result);
    } catch (error) {
      results.push({ id: candidate.id, status: 'error', error: error.message });
    }
  }
  return NextResponse.json({ checked: overdue.length, results });
}
