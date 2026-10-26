import prisma from './prisma';
import { ApiError } from './apiError';
import { resolveBranchAccess, canAccessBranch, canAccessRecord } from './branchAccessRules.mjs';

export { canAccessBranch, filterByBranchAccess, branchScope } from './branchAccessRules.mjs';

// The one place "does this staff member handle branch X" gets decided. UserBranchAccess
// (prisma/schema.prisma) tags a staff role to specific branches; this reads it back.
//
// Returns `null` for "every branch in the org" and a branch id array otherwise. It fails closed: a
// manager, supervisor, cashier or other staff role with no UserBranchAccess rows gets `[]` — no branch —
// until an Admin assigns one. Only the owner, the organization-wide roles and the auditors are
// unrestricted without rows (the rule itself lives in lib/branchAccessRules.mjs so it can be tested).
export async function getAccessibleBranchIds(session) {
  if (!session?.user?.id) return [];
  const { role, businessType } = session.user;
  if (role === 'owner') return null;

  const rows = await prisma.userBranchAccess.findMany({ where: { userId: session.user.id }, select: { branchId: true } });
  return resolveBranchAccess({ role, businessType, branchIds: rows.map((r) => r.branchId) });
}

// Server-side gate for any route that takes or derives a branch: throws ApiError 403 unless the caller
// may act on `branchId`, and returns their accessible ids for further filtering. For `/[id]` routes pass
// the branch of the loaded record (shift, tank, delivery…), never one the client sent.
export async function requireBranch(session, branchId) {
  const accessible = await getAccessibleBranchIds(session);
  if (!branchId) throw new ApiError('Select a station', 400);
  if (!canAccessBranch(accessible, branchId)) throw new ApiError('You do not have access to this station', 403);
  return accessible;
}

// The same gate for a record loaded by id (shift, tank, pump, attendant, delivery, deposit, flag…): its
// own `branchId` decides, never anything the client sent. A record that is missing and one at a station
// the caller cannot open both answer 404 with the same message, so an id from another station reveals
// nothing about it. A record with no branch (an org-level flag) is reachable only by an unrestricted user.
export async function requireRecordBranch(session, record, notFoundMessage) {
  const accessible = await getAccessibleBranchIds(session);
  if (!canAccessRecord(accessible, record)) throw new ApiError(notFoundMessage, 404);
  return accessible;
}
