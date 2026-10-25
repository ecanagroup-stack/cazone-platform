export const BUSINESS_INVITABLE_ROLES = {
  fuel_station: ['manager', 'supervisor', 'cashier', 'auditor', 'daily_auditor', 'external_auditor', 'staff'],
  shop: ['manager', 'materials_manager', 'atc_manager', 'auditor', 'staff'],
  general_store: ['manager', 'auditor', 'staff'],
};

// Roles an active add-on unlocks on top of the business type's own list (add-on type -> roles).
export const ADDON_ROLES = {
  distributor: ['atc_manager'],
};

// `addonTypes` are the org's ACTIVE add-on types; a lapsed add-on drops its role from this list, which
// only stops new accounts being created (existing ones show as "Legacy role" on the users page).
export function invitableRolesForBusiness(businessType, addonTypes = []) {
  const base = BUSINESS_INVITABLE_ROLES[businessType];
  if (!base) return [];
  const extra = addonTypes.flatMap((type) => ADDON_ROLES[type] || []).filter((role) => !base.includes(role));
  return [...base, ...extra];
}

// Roles that work across the whole organization and so need no branch picked: the ATC manager of a fuel
// station's distributor add-on (a shop's ATC manager is still branch-bound, like every shop role).
export function isOrgWideRole(role, businessType) {
  return role === 'atc_manager' && businessType === 'fuel_station';
}
