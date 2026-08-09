import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage tanks' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.label === 'string' && body.label.trim()) update.label = body.label.trim();
    if (body.capacity !== undefined) {
      const n = Number(body.capacity);
      if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Capacity must be a positive number' }, { status: 400 });
      update.capacity = n;
    }
    const updated = await prisma.tank.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
