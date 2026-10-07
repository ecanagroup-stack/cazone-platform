import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'sales.record')) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (!['shop', 'general_store'].includes(organization?.businessType)) return NextResponse.json({ error: 'Not available for this business' }, { status: 403 });
  const branchIds = await getAccessibleBranchIds(session);
  const orders = await prisma.order.findMany({
    where: { status: 'pending', branch: { service: { type: organization.businessType } },
      ...(branchIds === null ? {} : { branchId: { in: branchIds } }) },
    include: { lines: { include: { product: true } }, customer: true, branch: true },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, data: orders });
});
