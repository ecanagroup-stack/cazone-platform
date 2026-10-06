export const BUSINESS_INVITABLE_ROLES = {
  fuel_station: ['manager', 'supervisor', 'cashier', 'auditor', 'daily_auditor', 'external_auditor', 'staff'],
  shop: ['manager', 'materials_manager', 'atc_manager', 'auditor', 'staff'],
  general_store: ['manager', 'auditor', 'staff'],
};

export function invitableRolesForBusiness(businessType) {
  return BUSINESS_INVITABLE_ROLES[businessType] || [];
}
