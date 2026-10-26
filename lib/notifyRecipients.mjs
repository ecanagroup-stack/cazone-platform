// Who is told when someone alters money, stock or prices. Pure so the routing table can be tested
// without a database — lib/notify.js loads the candidate users and applies this.
export const ADMIN_ROLE = 'owner';
export const GSM_ROLE = 'materials_manager';
export const AUDITOR_ROLES = ['auditor', 'daily_auditor', 'external_auditor'];
export const BRANCH_MANAGER_ROLE = 'manager';

// Roles of every user that can ever be a recipient (the branch manager is further limited by branch).
export const ALTERATION_CANDIDATE_ROLES = [ADMIN_ROLE, GSM_ROLE, ...AUDITOR_ROLES, BRANCH_MANAGER_ROLE];

// Organization-wide recipient roles for an actor's role: the other oversight roles, never the actor's own.
// The affected branch's manager is added separately by alterationRecipients().
export function alterationRecipientRoles(actorRole) {
  if (actorRole === GSM_ROLE) return [ADMIN_ROLE, ...AUDITOR_ROLES];
  if (actorRole === ADMIN_ROLE) return [GSM_ROLE, ...AUDITOR_ROLES];
  if (AUDITOR_ROLES.includes(actorRole)) return [ADMIN_ROLE, GSM_ROLE];
  return [ADMIN_ROLE, GSM_ROLE, ...AUDITOR_ROLES];
}

// users: [{ id, role, isActive, branchIds }]. Returns recipient user ids, de-duplicated, active only,
// actor excluded. A `manager` is included only when they handle an affected branch — one `branchId`,
// or several `branchIds` for a customer-level change (a customer can span branches). A manager with
// no branch rows handles no branch (lib/branchAccess.js fails closed), so is never a recipient. An
// auditor or GSM with branch rows is told only about those branches (no rows = the whole business).
export function alterationRecipients({ actor, branchId, branchIds, users }) {
  const roles = new Set(alterationRecipientRoles(actor?.role));
  const affected = new Set([branchId, ...(branchIds || [])].filter(Boolean));
  const ids = new Set();
  for (const user of users || []) {
    if (!user.isActive || user.id === actor?.id) continue;
    const userBranchIds = user.branchIds || [];
    const handlesAffected = userBranchIds.some((id) => affected.has(id));
    const isBranchManager = user.role === BRANCH_MANAGER_ROLE && handlesAffected;
    // An auditor or GSM limited to some branches hears only about those; one with no rows is whole-business.
    const isOverseer = roles.has(user.role) && (user.role === ADMIN_ROLE || !userBranchIds.length || !affected.size || handlesAffected);
    if (isOverseer || isBranchManager) ids.add(user.id);
  }
  return [...ids];
}
