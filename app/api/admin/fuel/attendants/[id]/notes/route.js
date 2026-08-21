import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// A free-text entry on an attendant's personnel record — same manage-attendants gate as the rest
// of the Attendants tab. Notes are append-only, no edit/delete (matches AuditLog's own shape).
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to add a note' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const note = (body.note || '').trim();
    if (!note) throw new ApiError('A note is required', 400);

    const attendant = await prisma.attendant.findUnique({ where: { id } });
    if (!attendant) throw new ApiError('Attendant not found', 404);

    const created = await prisma.attendantNote.create({
      data: { attendantId: id, note, addedBy: session.user.name },
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
