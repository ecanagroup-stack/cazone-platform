import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds, branchScope } from '@/lib/branchAccess';

// Defaults to pending proposals (what the owner review screen needs); ?status= for the full log. A
// proposal with no branch covers the whole business, so only an unrestricted viewer sees it; everyone
// else sees the proposals of the stations they handle, plus any they proposed themselves.
export const GET = withOrg(async (request) => {
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  const session = await getOrgSession();
  const access = await getAccessibleBranchIds(session);
  const rows = await prisma.priceHistory.findMany({
    where: {
      ...(status === 'all' ? {} : { status }),
      ...(access === null ? {} : { OR: [branchScope(access), { changedBy: session.user.id }] }),
    },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ success: true, data: rows });
});
