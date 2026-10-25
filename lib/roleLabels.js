// Display names only — the Role enum, permission keys and 'owner' checks all stay as they are. The
// organization's top account is the "Admin" in the product's language; `owner` is just its stored value.
export const ROLE_LABELS = {
  super_admin: 'Platform Admin',
  owner: 'Admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
  cashier: 'Cashier',
  materials_manager: 'GSM Manager',
  atc_manager: 'ATC Manager',
  auditor: 'Auditor',
  daily_auditor: 'Daily Auditor',
  external_auditor: 'External Auditor',
  staff: 'Staff',
  customer: 'Customer',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '';
}
