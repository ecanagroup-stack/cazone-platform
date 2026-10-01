import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { summarizePumpCollection } from '@/lib/fuelCollections.mjs';

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
      where: { branchId, operatingDate: { gte: from, lte: to } },
      select: { id: true, operatingDate: true },
    });
    if (shifts.length === 0) return NextResponse.json({ success: true, data: { rows: [], byDay: [] } });
    const shiftIds = shifts.map((s) => s.id);
    const dateByShiftId = Object.fromEntries(shifts.map((s) => [s.id, s.operatingDate]));

    const [assignments, readings, collections] = await Promise.all([
      prisma.attendantAssignment.findMany({
        where: { shiftId: { in: shiftIds } },
        include: { attendant: true, dispenser: true },
      }),
      prisma.meterReading.findMany({
        where: { shiftId: { in: shiftIds } },
      }),
      prisma.fuelCollection.findMany({ where: { shiftId: { in: shiftIds } }, orderBy: { createdAt: 'asc' } }),
    ]);

    const readingByKey = Object.fromEntries(readings.map((r) => [`${r.shiftId}|${r.dispenserId}`, r]));

    const dayMap = new Map(); // `${attendantId}|${date}` -> row
    const assignedPumps = new Set();
    for (const a of assignments.sort((left, right) => right.assignedAt - left.assignedAt)) {
      const pumpKey = `${a.shiftId}|${a.dispenserId}`;
      if (assignedPumps.has(pumpKey)) continue;
      assignedPumps.add(pumpKey);
      const pumpCollections = collections.filter((c) => c.shiftId === a.shiftId && c.dispenserId === a.dispenserId);
      const initialAttendant = pumpCollections.find((c) => !c.voidedAt && c.collectionType === 'initial')?.attendantId;
      const owner = initialAttendant ? assignments.find((candidate) => candidate.attendantId === initialAttendant && candidate.shiftId === a.shiftId && candidate.dispenserId === a.dispenserId) || a : a;
      const date = dateByShiftId[a.shiftId];
      const key = `${owner.attendantId}|${date}`;
      const row = dayMap.get(key) || {
        attendantId: owner.attendantId, attendantName: owner.attendant.name, attendantStaffNumber: owner.attendant.staffNumber,
        date, pumps: new Set(), meterSales: 0, collected: 0, shortage: 0, overage: 0,
      };
      row.pumps.add(a.dispenser.label);
      const reading = readingByKey[`${a.shiftId}|${a.dispenserId}`];
      if (reading && reading.closing != null) {
        const pump = summarizePumpCollection(reading.expectedAmount, pumpCollections);
        row.meterSales += pump.expected;
        row.collected += pump.collected;
        row.shortage += pump.outstanding;
        row.overage += pump.overage;
      }
      dayMap.set(key, row);
    }

    const byDay = [...dayMap.values()].map((row) => {
      return { ...row, pumps: [...row.pumps] };
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
