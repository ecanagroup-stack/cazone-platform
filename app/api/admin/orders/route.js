import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (!['shop', 'general_store'].includes(org?.businessType)) {
    return NextResponse.json({ error: 'Not available for this business' }, { status: 404 });
  }
  const branchIds = await getAccessibleBranchIds(session);
  const orders = await prisma.order.findMany({
    where: branchIds === null ? {} : { branchId: { in: branchIds } },
    include: {
      customer: { select: { name: true } },
      branch: { select: { name: true } },
      lines: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({ success: true, data: orders });
});
