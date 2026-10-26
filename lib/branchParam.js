import { redirect } from 'next/navigation';
import prisma from './prisma';
import { getOrgSession } from './session';
import { requireOrg } from './tenantScope';
import { getAccessibleBranchIds, branchScope } from './branchAccess';
import { resolveBranchParam } from './branchAccessRules.mjs';

// Server half of the `?branch=` URL a station page reads: a branch the caller may not open (typed by hand,
// from an old link, or from another login) is swapped for one they can, so the page never renders against
// it. The APIs refuse it too (lib/branchAccess.js requireBranch); this just lands the person somewhere
// useful. Call from a server `page.js` that wraps the client page.
export async function guardBranchParam(path, searchParams) {
  const params = await searchParams;
  const requested = params?.branch;
  if (!requested) return;
  const session = await getOrgSession();
  if (!session?.user?.id) return;
  requireOrg(session);
  const [access, me] = await Promise.all([
    getAccessibleBranchIds(session),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { lastBranchId: true } }),
  ]);
  const branches = await prisma.branch.findMany({ where: branchScope(access, 'id'), select: { id: true, isActive: true }, orderBy: { name: 'asc' } });
  const branch = resolveBranchParam({ requested, branches, preferredId: me?.lastBranchId });
  if (branch === requested) return;

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'branch') continue;
    for (const v of [].concat(value)) if (typeof v === 'string') next.append(key, v);
  }
  if (branch) next.set('branch', branch);
  const qs = next.toString();
  redirect(qs ? `${path}?${qs}` : path);
}
