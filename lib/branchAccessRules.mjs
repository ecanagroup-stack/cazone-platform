import { isOrgWideRole } from './businessRoles.js';
import { AUDITOR_ROLES, GSM_ROLE } from './notifyRecipients.mjs';

// The pure half of lib/branchAccess.js: given a staff member's role and their UserBranchAccess rows,
// which branches may they act on? `null` means "every branch in the org".
//
// Fail closed: only the owner, the organization-wide roles (a fuel station's ATC manager), the auditors
// and the shop GSM (materials_manager, the business-wide overseer lib/notifyRecipients.mjs and
// lib/permissions.js already treat as org-level) may have no branch rows and still see everything. A manager, supervisor, cashier or any other
// staff role with zero rows sees NO branch until an Admin assigns one. Having rows always narrows to
// those branches, whatever the role (except the owner, who is never narrowed).
export function resolveBranchAccess({ role, businessType, branchIds }) {
  if (!role) return [];
  if (role === 'owner') return null;
  if (branchIds?.length) return [...new Set(branchIds)];
  if (isOrgWideRole(role, businessType) || AUDITOR_ROLES.includes(role) || role === GSM_ROLE) return null;
  return [];
}

// True for a role that sees every branch when it has no rows. Lets screens tell "whole business" apart
// from "no station assigned" without re-deriving the rule.
export function seesEveryBranchWithoutRows(role, businessType) {
  return resolveBranchAccess({ role, businessType, branchIds: [] }) === null;
}

// True if `branchId` is within what `accessibleBranchIds` (null = every branch) allows.
export function canAccessBranch(accessibleBranchIds, branchId) {
  return accessibleBranchIds === null || (!!branchId && accessibleBranchIds.includes(branchId));
}

// Keeps only the rows whose branch the caller may see. `branchOf` reads the branch id off a row.
export function filterByBranchAccess(rows, accessibleBranchIds, branchOf = (row) => row.branchId) {
  if (accessibleBranchIds === null) return rows;
  return rows.filter((row) => accessibleBranchIds.includes(branchOf(row)));
}

// Prisma `where` fragment limiting `field` to the accessible branches: nothing for "every branch", and
// an empty `in` (matches nothing) for a user with no branches.
export function branchScope(accessibleBranchIds, field = 'branchId') {
  return accessibleBranchIds === null ? {} : { [field]: { in: accessibleBranchIds } };
}

// The station set a user ends up with when `actorIds` (null = unrestricted) replaces their stations with
// `requestedIds`. An unrestricted actor replaces the whole set; a manager only decides the stations they
// manage themselves, so the user's stations outside the manager's own are left untouched.
export function mergeAssignedBranches({ existingIds, requestedIds, actorIds }) {
  const requested = [...new Set(requestedIds)];
  if (actorIds === null) return requested;
  return [...new Set([...existingIds.filter((id) => !actorIds.includes(id)), ...requested])];
}

// Accounts that are not staff and so never take branch rows.
const NON_STAFF_ROLES = ['customer', 'super_admin'];

// Rules for editing another user's stations (PATCH /api/admin/users/[id]). `actorIds` is the actor's own
// accessible set (null = owner or org-wide), `requestedIds` what they asked for and `finalIds` the merged
// result. Returns { error, status }, or null when the change is allowed.
export function branchAssignmentError({ actorRole, actorIds, targetRole, businessType, requestedIds, finalIds }) {
  if (NON_STAFF_ROLES.includes(targetRole)) return { error: 'Stations can be assigned to staff accounts only', status: 400 };
  if (targetRole === 'owner') return { error: 'The Admin account is not tied to stations', status: 400 };
  if (isOrgWideRole(targetRole, businessType)) {
    return requestedIds.length ? { error: 'The ATC manager works across the whole business, so no station can be assigned', status: 400 } : null;
  }
  if (actorRole !== 'owner') {
    if (['owner', 'manager'].includes(targetRole)) return { error: 'Only the Admin can manage Admin and manager accounts', status: 403 };
    if (actorIds !== null && requestedIds.some((id) => !actorIds.includes(id))) return { error: 'You can assign users only to stations you manage', status: 403 };
  }
  // Clearing every station turns an auditor/GSM into a whole-business one, which only an unrestricted
  // actor (the Admin) may grant; everyone else must leave at least one.
  if (finalIds.length === 0 && (actorIds !== null || !seesEveryBranchWithoutRows(targetRole, businessType))) return { error: 'Select at least one station for this user', status: 400 };
  return null;
}
