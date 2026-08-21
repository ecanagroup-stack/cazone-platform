import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Add a pump to an already-open shift — petrol-station-app's "Open Pumps" late-add. Same
// AttendantAssignment + opening MeterReading shape Begin Shift creates per dispenser
// (app/api/admin/fuel/shift/begin/route.js), just for one dispenser onto an existing shift instead
// of the whole batch at shift start.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id: shiftId } = await params;
    const body = await request.json();
    const dispenserId = body.dispenserId;
    const attendantId = body.attendantId;
    const opening = Number(body.opening);
    if (!dispenserId || !attendantId || !Number.isFinite(opening)) {
      throw new ApiError('A dispenser, attendant and opening reading are required', 400);
    }

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const existing = await prisma.attendantAssignment.findFirst({ where: { shiftId, dispenserId, endedAt: null } });
    if (existing) throw new ApiError('This pump is already part of the shift', 400);

    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.attendantAssignment.create({
        data: { branchId: shift.branchId, dispenserId, shiftId, attendantId, assignedBy: session.user.id },
        include: { attendant: true, dispenser: { include: { tank: { include: { product: true } } } } },
      });
      const reading = await tx.meterReading.create({
        data: { branchId: shift.branchId, dispenserId, shiftId, opening, recordedBy: session.user.id },
      });
      return { assignment, reading };
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
