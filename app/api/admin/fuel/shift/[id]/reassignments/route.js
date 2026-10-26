import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { requireBranch } from '@/lib/branchAccess';

// Reassignment log for a shift — every ended-with-a-reason assignment, most recent first.
export const GET = withOrg(async (request, { params }) => {
  try {
    const { id: shiftId } = await params;
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { branchId: true } });
    if (!shift) throw new ApiError('Shift not found', 404);
    await requireBranch(await getOrgSession(), shift.branchId);
    const log = await prisma.attendantAssignment.findMany({
      where: { shiftId, reassignReason: { not: null } },
      include: { attendant: true, dispenser: true },
      orderBy: { endedAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: log });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
