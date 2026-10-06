import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

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

    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (update.lastServiceId) {
      const service = await prisma.service.findUnique({ where: { id: update.lastServiceId }, select: { type: true, isActive: true, config: true } });
      if ((!service?.isActive && service?.config?.migrationStockPending !== true) || service?.type !== org.businessType) return NextResponse.json({ error: 'Choose a service in your registered business' }, { status: 400 });
    }
    if (update.lastBranchId) {
      const accessibleBranches = await getAccessibleBranchIds(session);
      if (accessibleBranches && !accessibleBranches.includes(update.lastBranchId)) return NextResponse.json({ error: 'Branch access denied' }, { status: 403 });
      const branch = await prisma.branch.findUnique({ where: { id: update.lastBranchId }, select: { serviceId: true, service: { select: { type: true, isActive: true, config: true } } } });
      if ((!branch?.service.isActive && branch?.service.config?.migrationStockPending !== true) || branch?.service.type !== org.businessType || (update.lastServiceId && update.lastServiceId !== branch.serviceId)) return NextResponse.json({ error: 'Choose a branch in your registered business' }, { status: 400 });
    }

    await prisma.user.update({ where: { id: session.user.id }, data: update });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
});
