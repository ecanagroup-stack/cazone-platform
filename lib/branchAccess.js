import prisma from './prisma';

// The one place "does this staff member handle branch X" gets decided. UserBranchAccess
// (prisma/schema.prisma) has existed since the Invite User form let an owner/manager tag a staff
// role to specific branches, but nothing ever read it back — every role saw/acted on every branch in
// the org regardless. This activates it, foundation for customers becoming branch-bound.
//
// Returns `null` for "unrestricted, sees every branch in the org" — the owner role always, and any
// other role that simply has zero UserBranchAccess rows (matches every account created before this
// existed, so nothing already in production regresses). Returns a branch id array otherwise.
export async function getAccessibleBranchIds(session) {
  if (!session?.user?.id) return [];
  if (session.user.role === 'owner') return null;

  const rows = await prisma.userBranchAccess.findMany({ where: { userId: session.user.id }, select: { branchId: true } });
  if (rows.length === 0) return null;
  return rows.map((r) => r.branchId);
}

// True if `branchId` is within what `accessibleBranchIds` (the result of the function above) allows.
export function canAccessBranch(accessibleBranchIds, branchId) {
  return accessibleBranchIds === null || accessibleBranchIds.includes(branchId);
}
