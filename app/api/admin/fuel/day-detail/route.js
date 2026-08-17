import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Ported from petrol-station-app's admin Reports Day Detail (Manager/Supervisor/Cashier tabs) — a
// read-only drill-in from Summary Book for one day, one branch. Unlike the old app, this never lets
// anything be silently overwritten: every record here already carries (or gets, via the delivery
// correction route) its own audited correction path — see the Summary Book page for how each section
// links to it (query a reading, approve/reject a deposit, correct a delivery).
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const date = url.searchParams.get('date');
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!date) throw new ApiError('date is required', 400);

    const range = { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) };

    const shifts = await prisma.shift.findMany({
      where: { branchId, openedAt: range },
      orderBy: { openedAt: 'asc' },
    });

    const shiftIds = shifts.map((s) => s.id);
    const [assignments, readings, deliveries, reconciliations, deposits] = await Promise.all([
      prisma.attendantAssignment.findMany({
        where: { shiftId: { in: shiftIds } },
        include: { attendant: true, dispenser: { include: { tank: { include: { product: true } } } } },
      }),
      prisma.meterReading.findMany({
        where: { shiftId: { in: shiftIds } },
        include: { dispenser: true, posPayments: { include: { terminal: true } } },
      }),
      prisma.delivery.findMany({
        where: { branchId, createdAt: range },
        include: { supplier: true, vehicle: true, product: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.reconciliation.findMany({
        where: { branchId, periodEnd: range },
        include: { product: true },
        orderBy: { periodEnd: 'desc' },
      }),
      prisma.cashDeposit.findMany({
        where: { shiftId: { in: shiftIds } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const byShift = shifts.map((shift) => ({
      shift,
      assignments: assignments.filter((a) => a.shiftId === shift.id),
      readings: readings.filter((r) => r.shiftId === shift.id),
      deposits: deposits.filter((d) => d.shiftId === shift.id),
    }));

    return NextResponse.json({ success: true, data: { shifts: byShift, deliveries, reconciliations } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
