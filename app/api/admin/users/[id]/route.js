import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';

// Deactivate only — removing a user never deletes their history (platform-ui skill, section 5).
// There's no history to preserve yet in this core layer, but the rule holds from day one.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to manage users' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    const updated = await prisma.user.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: { id: updated.id, isActive: updated.isActive } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
