import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Ported from petrol-station-app's /api/attendant-performance + Staff Performance Heatmap — per
// attendant, per day: which pumps they worked, meter sales value vs. cash+POS actually collected,
// and the resulting shortage/overage. Unlike the old app (which joined MeterReading/PaymentRecord/
// DayShift by date strings), cazone's MeterReading already carries its own computed litres/
// expectedAmount/cashCollected (see the schema note on MeterReading), so this is a much thinner
// aggregation — one shift/reading join per assignment, no separate price lookup.
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to') || from;
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!from) throw new ApiError('from is required', 400);

    const shifts = await prisma.shift.findMany({
      where: { branchId, openedAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } },
      select: { id: true, openedAt: true },
    });
    if (shifts.length === 0) return NextResponse.json({ success: true, data: { rows: [], byDay: [] } });
    const shiftIds = shifts.map((s) => s.id);
    const dateByShiftId = Object.fromEntries(shifts.map((s) => [s.id, s.openedAt.toISOString().slice(0, 10)]));

    const [assignments, readings] = await Promise.all([
      prisma.attendantAssignment.findMany({
        where: { shiftId: { in: shiftIds } },
        include: { attendant: true, dispenser: true },
      }),
      prisma.meterReading.findMany({
        where: { shiftId: { in: shiftIds } },
        include: { posPayments: true },
      }),
    ]);

    const readingByKey = Object.fromEntries(readings.map((r) => [`${r.shiftId}|${r.dispenserId}`, r]));

    const dayMap = new Map(); // `${attendantId}|${date}` -> row
    for (const a of assignments) {
      const date = dateByShiftId[a.shiftId];
      const key = `${a.attendantId}|${date}`;
      const row = dayMap.get(key) || {
        attendantId: a.attendantId, attendantName: a.attendant.name, attendantStaffNumber: a.attendant.staffNumber,
        date, pumps: new Set(), meterSales: 0, collected: 0,
      };
      row.pumps.add(a.dispenser.label);
      const reading = readingByKey[`${a.shiftId}|${a.dispenserId}`];
      if (reading && reading.closing != null) {
        row.meterSales += reading.expectedAmount || 0;
        row.collected += (reading.cashCollected || 0) + reading.posPayments.reduce((s, p) => s + p.amount, 0);
      }
      dayMap.set(key, row);
    }

    const byDay = [...dayMap.values()].map((row) => {
      const shortage = Math.max(0, row.meterSales - row.collected);
      const overage = Math.max(0, row.collected - row.meterSales);
      return { ...row, pumps: [...row.pumps], shortage, overage };
    }).sort((a, b) => b.date.localeCompare(a.date));

    const attendantMap = new Map();
    for (const row of byDay) {
      const ag = attendantMap.get(row.attendantId) || {
        attendantId: row.attendantId, attendantName: row.attendantName, attendantStaffNumber: row.attendantStaffNumber,
        daysWorked: 0, totalMeterSales: 0, totalCollected: 0, totalShortage: 0, totalOverage: 0, shortageOccurrences: 0,
      };
      ag.daysWorked += 1;
      ag.totalMeterSales += row.meterSales;
      ag.totalCollected += row.collected;
      ag.totalShortage += row.shortage;
      ag.totalOverage += row.overage;
      if (row.shortage > 0) ag.shortageOccurrences += 1;
      attendantMap.set(row.attendantId, ag);
    }
    const rows = [...attendantMap.values()].sort((a, b) => a.attendantStaffNumber.localeCompare(b.attendantStaffNumber));

    return NextResponse.json({ success: true, data: { rows, byDay } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
