import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// core-algorithms skill §5: "raise an exception that a manager must acknowledge with a reason
// before the period can close" — there's no period-close gate yet, but the acknowledge-with-a-
// reason requirement is enforced here regardless.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'exceptions.manage')) {
    return NextResponse.json({ error: 'You do not have permission to acknowledge exceptions' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const note = (body.note || '').trim();
    if (!note) throw new ApiError('A note is required to acknowledge', 400);

    const flag = await prisma.flag.findUnique({ where: { id } });
    if (!flag) throw new ApiError('Not found', 404);

    const updated = await prisma.flag.update({
      where: { id },
      data: { status: 'resolved', resolvedBy: session.user.id, reason: `${flag.reason}\n\nAcknowledged: ${note}` },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
