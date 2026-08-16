import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

// Fire-and-forget from ServiceBranchSwitcher's setParam whenever the selection changes — restored on
// next login by app/admin/layout.js so a multi-service/multi-branch org doesn't re-pick every time.
export const PATCH = withOrg(async (request) => {
  const session = await getOrgSession();
  try {
    const body = await request.json();
    const update = {};
    if ('serviceId' in body) update.lastServiceId = body.serviceId || null;
    if ('branchId' in body) update.lastBranchId = body.branchId || null;
    if (Object.keys(update).length === 0) return NextResponse.json({ success: true });

    await prisma.user.update({ where: { id: session.user.id }, data: update });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
});
