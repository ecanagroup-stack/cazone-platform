// Central permission matrix for the platform-level roles. Deliberately minimal — no vertical-
// specific permissions live here, except fuel's supervisor/cashier/auditor tier and Construction
// Material's materials_manager/atc_manager tier (below), each ported from its own single-tenant
// reference's actual role structure (petrol-station-app's 3-tier review chain; ecana_shop-app's
// gsm_manager/atc_manager split) closely enough to earn a real role rather than another permission
// string on staff.
const PERMISSIONS = {
  owner: ['*'],
  manager: [
    'users.invite', 'branches.manage', 'services.manage', 'shifts.run', 'sales.record', 'customers.manage',
    'stock.receive', 'exceptions.manage', 'allocations.manage', 'materials.catalog.manage',
    // Fuel review chain — a manager can do every tier, and is the only non-owner role that can
    // approve (supervisor/cashier submit, they don't approve their own or each other's entries).
    'flags.raise', 'fuel.readings.submit', 'fuel.readings.approve', 'fuel.payments.record', 'fuel.payments.approve',
  ],
  // Counter/warehouse work — running a shift, ringing up a sale, taking a payment, recording what a
  // truck dropped off — isn't management, so any staff member with access to the branch can do it,
  // not just managers. Changing a credit limit or hold status IS management (an auditable, "worth
  // watching" action) and stays manager+ only.
  staff: ['shifts.run', 'sales.record', 'stock.receive'],
  // Fuel-specific tier, additive to staff — an org running the full review chain assigns these
  // instead of/alongside staff, not as a replacement for staff's cross-pack permissions.
  supervisor: ['fuel.readings.submit'],
  cashier: ['fuel.payments.record'],
  // Construction Material's day-to-day manager (ecana's gsm_manager) — sales, customers, stock,
  // ATC lifecycle, and cement/aggregate/shop catalog upkeep, but no branch/service/user admin.
  materials_manager: ['shifts.run', 'sales.record', 'customers.manage', 'stock.receive', 'allocations.manage', 'materials.catalog.manage'],
  // Construction Material's narrow ATC-only role (ecana's atc_manager) — assign/loading/arrive plus
  // recording the delivery itself, nothing else.
  atc_manager: ['allocations.manage', 'stock.receive'],
  auditor: ['flags.raise'],
  customer: [],
};

export function can(role, permission) {
  if (!role) return false;
  if (role === 'super_admin') return true; // cross-tenant platform operator, not org-scoped
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

export const STAFF_ROLES = ['owner', 'manager', 'supervisor', 'cashier', 'materials_manager', 'atc_manager', 'auditor', 'staff'];
