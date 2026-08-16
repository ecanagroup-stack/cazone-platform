import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Mid-shift attendant swap on a pump — a permanent audit trail, not an edit. Ends the current
// AttendantAssignment with a required reason and opens a new one for the replacement attendant.
// Matches petrol-station-app's PumpReassignment: distinct from the original assignment, viewable as
// a log (GET below), not a field that gets overwritten.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const newAttendantId = body.attendantId;
    const reason = (body.reason || '').trim();
    if (!newAttendantId) throw new ApiError('Pick the attendant taking over this pump', 400);
    if (!reason) throw new ApiError('A reason is required for a reassignment', 400);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const current = await prisma.attendantAssignment.findFirst({ where: { shiftId, dispenserId, endedAt: null } });
    if (!current) throw new ApiError('No active assignment found for this pump', 404);
    if (current.attendantId === newAttendantId) throw new ApiError('That attendant is already assigned to this pump', 400);

    const result = await prisma.$transaction(async (tx) => {
      await tx.attendantAssignment.update({
        where: { id: current.id },
        data: { endedAt: new Date(), endedBy: session.user.id, reassignReason: reason },
      });
      return tx.attendantAssignment.create({
        data: { branchId: shift.branchId, dispenserId, shiftId, attendantId: newAttendantId, assignedBy: session.user.id },
        include: { attendant: true },
      });
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
