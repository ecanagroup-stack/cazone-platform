import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds, branchScope } from '@/lib/branchAccess';

// "Anything wrong" — org-wide for the Admin (platform-ui skill §7's owner-view convention); everyone else
// sees only the flags of the stations they handle. A flag with no branch belongs to the whole business,
// so only an unrestricted viewer sees it.
// Every Flag this platform creates (credit overrides, cash-up differences, reconciliation
// variances) lands here; this is the first screen that actually reads the Flag table.
export const GET = withOrg(async (request) => {
  const includeResolved = new URL(request.url).searchParams.get('all') === 'true';
  const access = await getAccessibleBranchIds(await getOrgSession());
  const flags = await prisma.flag.findMany({
    where: { ...(includeResolved ? {} : { status: { not: 'resolved' } }), ...branchScope(access) },
    orderBy: { createdAt: 'desc' },
  });
  const branchIds = [...new Set(flags.map((f) => f.branchId).filter(Boolean))];
  const branches = await prisma.branch.findMany({ where: { id: { in: branchIds } } });
  const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  const data = flags.map((f) => ({ ...f, branchName: f.branchId ? branchNameById[f.branchId] || null : null }));
  return NextResponse.json({ success: true, data });
});
