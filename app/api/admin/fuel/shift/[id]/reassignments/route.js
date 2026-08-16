import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Reassignment log for a shift — every ended-with-a-reason assignment, most recent first.
export const GET = withOrg(async (request, { params }) => {
  const { id: shiftId } = await params;
  const log = await prisma.attendantAssignment.findMany({
    where: { shiftId, reassignReason: { not: null } },
    include: { attendant: true, dispenser: true },
    orderBy: { endedAt: 'desc' },
  });
  return NextResponse.json({ success: true, data: log });
});
