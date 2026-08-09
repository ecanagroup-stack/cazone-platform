import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage dispensers' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const tankId = body.tankId;
    const label = (body.label || '').trim();
    if (!tankId || !label) throw new ApiError('Tank and dispenser label are required', 400);

    const tank = await prisma.tank.findUnique({ where: { id: tankId } });
    if (!tank) throw new ApiError('Tank not found', 404);

    const dispenser = await prisma.dispenser.create({ data: { branchId: tank.branchId, tankId, label } });
    return NextResponse.json({ success: true, data: dispenser }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
