import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Drop a pump that was opened by mistake — petrol-station-app's "Open Pumps" force-remove. Only
// available while the pump is still untouched (opened, nothing submitted yet): once a closing
// reading exists — pending, queried or approved — this codebase's rule is "never destroy a
// submitted record" (same spirit as the approve/correct routes), so Reassign or a Phase-D
// correction is the way to fix it instead. Nothing else references a bare opening MeterReading or
// its AttendantAssignment, so a hard delete here is safe and correct.
export const DELETE = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const assignment = await prisma.attendantAssignment.findFirst({ where: { shiftId, dispenserId, endedAt: null } });
    if (!assignment) throw new ApiError('This pump is not part of the shift', 404);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (reading && reading.closing != null) {
      throw new ApiError('This pump already has a submitted reading — remove isn\'t available once anything is recorded. Use Reassign instead.', 400);
    }

    await prisma.$transaction(async (tx) => {
      if (reading) await tx.meterReading.delete({ where: { id: reading.id } });
      await tx.attendantAssignment.delete({ where: { id: assignment.id } });
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'shift.dispenser_removed', entityType: 'Shift', entityId: shiftId,
      before: { dispenserId, attendantId: assignment.attendantId }, after: null,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
