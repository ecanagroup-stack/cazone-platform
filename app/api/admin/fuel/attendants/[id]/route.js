import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// One attendant's full scorecard: every shift they've ever worked, meter sales vs. what was
// actually collected, and the resulting shortage/overage — same computation shape as
// app/api/admin/fuel/attendant-performance/route.js, just scoped to one attendant across all time
// instead of one branch across a date range.
export const GET = withOrg(async (request, { params }) => {
  try {
    const { id } = await params;
    const attendant = await prisma.attendant.findUnique({ where: { id } });
    if (!attendant) throw new ApiError('Attendant not found', 404);

    const [assignments, notes] = await Promise.all([
      prisma.attendantAssignment.findMany({
        where: { attendantId: id },
        include: { dispenser: true, shift: { select: { id: true, openedAt: true } } },
        orderBy: { assignedAt: 'asc' },
      }),
      prisma.attendantNote.findMany({ where: { attendantId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    const shiftIds = [...new Set(assignments.map((a) => a.shiftId))];
    const readings = shiftIds.length
      ? await prisma.meterReading.findMany({ where: { shiftId: { in: shiftIds } }, include: { posPayments: true } })
      : [];
    const readingByKey = Object.fromEntries(readings.map((r) => [`${r.shiftId}|${r.dispenserId}`, r]));

    const dayMap = new Map(); // date -> row
    for (const a of assignments) {
      const date = a.shift.openedAt.toISOString().slice(0, 10);
      const row = dayMap.get(date) || { date, pumps: new Set(), meterSales: 0, collected: 0 };
      row.pumps.add(a.dispenser.label);
      const reading = readingByKey[`${a.shiftId}|${a.dispenserId}`];
      if (reading && reading.closing != null) {
        row.meterSales += reading.expectedAmount || 0;
        row.collected += (reading.cashCollected || 0) + reading.posPayments.reduce((s, p) => s + p.amount, 0);
      }
      dayMap.set(date, row);
    }

    const byDay = [...dayMap.values()]
      .map((row) => {
        const shortage = Math.max(0, row.meterSales - row.collected);
        const overage = Math.max(0, row.collected - row.meterSales);
        return { ...row, pumps: [...row.pumps], shortage, overage };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    let longestCleanStreak = 0;
    let currentStreak = 0;
    for (const row of [...byDay].sort((a, b) => a.date.localeCompare(b.date))) {
      if (row.shortage === 0) { currentStreak += 1; longestCleanStreak = Math.max(longestCleanStreak, currentStreak); }
      else currentStreak = 0;
    }

    const summary = byDay.reduce(
      (acc, row) => ({
        daysWorked: acc.daysWorked + 1,
        totalMeterSales: acc.totalMeterSales + row.meterSales,
        totalCollected: acc.totalCollected + row.collected,
        totalShortage: acc.totalShortage + row.shortage,
        totalOverage: acc.totalOverage + row.overage,
        shortageOccurrences: acc.shortageOccurrences + (row.shortage > 0 ? 1 : 0),
      }),
      { daysWorked: 0, totalMeterSales: 0, totalCollected: 0, totalShortage: 0, totalOverage: 0, shortageOccurrences: 0 }
    );
    summary.longestCleanStreak = longestCleanStreak;

    return NextResponse.json({ success: true, data: { attendant, summary, byDay, notes } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

// Deactivate + edit core/HR fields — same "removing never deletes history" rule as User (platform-ui
// skill §5), since past AttendantAssignment/MeterReading rows keep referencing this attendant.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage attendants' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.phone === 'string') update.phone = body.phone.trim() || null;
    if (typeof body.position === 'string') update.position = body.position.trim() || null;
    if (typeof body.employmentType === 'string') update.employmentType = body.employmentType.trim() || null;
    if (typeof body.dateOfBirth === 'string') update.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    if (typeof body.gender === 'string') update.gender = body.gender.trim() || null;
    if (typeof body.employmentDate === 'string') update.employmentDate = body.employmentDate ? new Date(body.employmentDate) : null;
    if (typeof body.photoUrl === 'string') update.photoUrl = body.photoUrl.trim() || null;
    const updated = await prisma.attendant.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
