// A fuel station's ATC manager (the distributor add-on's role) also holds stock.receive, and the pump
// pages are only hidden from the sidebar, so middleware confines the role to the distribution pages.
// Pure and import-free because middleware runs on the edge runtime. Shop ATC managers are not
// confined (their cement work spans the shop pages).
const PAGE_PREFIXES = ['/admin/distributor', '/admin/account'];
const API_PREFIXES = ['/api/admin/distributor', '/api/admin/notifications', '/api/admin/me', '/api/account'];

const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

export function isConfinedAtcManager({ role, businessType }) {
  return role === 'atc_manager' && businessType === 'fuel_station';
}

// `/admin` itself stays open: it is the landing route that redirects the role to /admin/distributor.
export function atcManagerMayVisit(pathname) {
  return pathname === '/admin' || PAGE_PREFIXES.some((prefix) => under(pathname, prefix));
}

export function atcManagerMayCall(pathname) {
  return API_PREFIXES.some((prefix) => under(pathname, prefix));
}
