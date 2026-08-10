// Central permission matrix for the five platform-level roles. Deliberately minimal — no
// vertical-specific permissions live here. A pack (fuel, materials, hotel...) extends this with its
// own entries when it lands (mirrors how ecana_shop-app layered gsm_manager/atc_manager on top of a
// similar base).
const PERMISSIONS = {
  owner: ['*'],
  manager: ['users.invite', 'branches.manage', 'services.manage', 'shifts.run', 'sales.record', 'customers.manage', 'stock.receive', 'exceptions.manage'],
  // Counter/warehouse work — running a shift, ringing up a sale, taking a payment, recording what a
  // truck dropped off — isn't management, so any staff member with access to the branch can do it,
  // not just managers. Changing a credit limit or hold status IS management (an auditable, "worth
  // watching" action) and stays manager+ only.
  staff: ['shifts.run', 'sales.record', 'stock.receive'],
  customer: [],
};

export function can(role, permission) {
  if (!role) return false;
  if (role === 'super_admin') return true; // cross-tenant platform operator, not org-scoped
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

export const STAFF_ROLES = ['owner', 'manager', 'staff'];
