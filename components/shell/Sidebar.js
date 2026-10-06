'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  FiHome, FiAlertTriangle, FiDroplet, FiShoppingCart, FiUsers, FiTruck, FiSettings, FiBox,
  FiMapPin, FiUserCheck, FiCreditCard, FiBarChart2, FiSliders, FiLayers, FiMap, FiFileText,
  FiCheckCircle, FiBookOpen, FiClock, FiShield, FiMessageSquare,
} from 'react-icons/fi';

const CHAT_POLL_MS = 30000;

// Same three groups, same order, for every vertical (platform-ui skill, section 1). Sell holds the
// counter itself — one entry per pack, not a list of pages. Manage's "at most two items per pack"
// budget is lifted for Construction Material specifically — ecana_shop-app's own nav has ~11 items
// across Setup/Operations for cement+aggregate+shop combined, and faithfully porting its dedicated
// pages (Cement Brands, Aggregate, Quarries, ...) means matching that depth, not force-fitting a
// budget that only ever fit a shallower approximation. `pack` tags an item to a ServiceCatalog key
// (lib/services.js) — items with no `pack` are core/shared and always show; pack items are filtered
// by the CURRENTLY SELECTED service's type (see the `services` prop + `?service=`), not by every
// service the org has ever enabled — an org running both fuel and construction material must not see
// Cement Brands/ATCs/etc. while it's the fuel branch that's actually selected, and vice versa.
const GROUPS = [
  {
    label: 'Sell',
    items: [
      { href: '/admin/fuel/shift', label: 'Pumps', icon: FiDroplet, pack: 'fuel_station' },
      { href: '/admin/fuel/collections', label: 'Pump Collections', icon: FiCreditCard, pack: 'fuel_station' },
      { href: '/admin/materials/counter', label: 'Cement Warehouse', icon: FiShoppingCart, pack: 'shop' },
      { href: '/admin/materials/sales/new', label: 'New Sale', icon: FiFileText, pack: 'shop' },
      { href: '/admin/retail/counter', label: 'Retail Counter', icon: FiShoppingCart, pack: 'general_store' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/admin/customers', label: 'Customers', icon: FiUsers },
      // Only the org's owner and its managers hold customer conversations — everyone else on staff
      // (plain staff, and the vertical-specific tiers like cashier/supervisor/materials_manager)
      // never sees this in the nav at all, not just a 403 if they guess the URL.
      { href: '/admin/messages', label: 'Messages', icon: FiMessageSquare, roles: ['owner', 'manager', 'materials_manager'] },
      { href: '/admin/deliveries', label: 'Deliveries', icon: FiTruck, roles: ['owner', 'manager', 'materials_manager', 'atc_manager', 'staff'] },
      { href: '/admin/fuel/tanks', label: 'Fuel Setup', icon: FiSettings, pack: 'fuel_station' },
      { href: '/admin/fuel/backfill', label: 'Historical Backfill', icon: FiClock, pack: 'fuel_station' },
      { href: '/admin/materials/cement-brands', label: 'Cement Brands', icon: FiBox, pack: 'shop' },
      { href: '/admin/materials/stonedust', label: 'Aggregate', icon: FiLayers, pack: 'shop' },
      { href: '/admin/materials/quarries', label: 'Quarries', icon: FiMap, pack: 'shop' },
      { href: '/admin/materials/trucks', label: 'Trucks', icon: FiTruck, pack: 'shop' },
      { href: '/admin/materials/atcs', label: 'ATCs', icon: FiFileText, pack: 'shop' },
      { href: '/admin/retail/products', label: 'Retail Products', icon: FiBox, pack: 'general_store' },
      { href: '/admin/services', label: 'Branches', icon: FiMapPin, roles: ['owner', 'manager'] },
      { href: '/admin/users', label: 'Users', icon: FiUserCheck, roles: ['owner', 'manager'] },
      { href: '/admin/price-approvals', label: 'Price Approvals', icon: FiCheckCircle, roles: ['owner', 'manager'] },
      { href: '/admin/billing', label: 'Subscription', icon: FiCreditCard, roles: ['owner'] },
      { href: '/admin/settings', label: 'Settings', icon: FiSliders, roles: ['owner', 'manager'] },
    ],
  },
  {
    label: 'Know',
    items: [
      { href: '/admin', label: 'Today', icon: FiHome },
      { href: '/admin/exceptions', label: 'Anything Wrong', icon: FiAlertTriangle, roles: ['owner', 'manager', 'materials_manager', 'auditor', 'daily_auditor'] },
      { href: '/admin/reports', label: 'Reports', icon: FiBarChart2, roles: ['owner', 'manager', 'materials_manager', 'auditor', 'daily_auditor', 'external_auditor'] },
      { href: '/admin/fuel/attendant-performance', label: 'Attendant Performance', icon: FiBarChart2, pack: 'fuel_station' },
      { href: '/admin/fuel/summary-book', label: 'Summary Book', icon: FiBookOpen, pack: 'fuel_station' },
      { href: '/admin/audit', label: 'Audit Log', icon: FiShield, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    ],
  },
];

// Petrol staff land in the same role-shaped workflow as the original station app.
// Every destination is a CaZone page backed by the tenant's own fuel records.
const FUEL_GROUPS = [
  { label: 'Shift work', items: [
    { href: '/admin/fuel/dashboard', label: 'Dashboard', icon: FiHome },
    { href: '/admin/fuel/shift', label: 'Begin / End Shift', icon: FiClock, roles: ['owner', 'manager', 'staff'] },
    { href: '/admin/fuel/shift', label: 'Record Sales', icon: FiDroplet, roles: ['supervisor'] },
    { href: '/admin/fuel/collections', label: 'Record Payments', icon: FiCreditCard, roles: ['cashier', 'owner', 'manager'] },
    { href: '/admin/fuel/historical-incomplete', label: 'Incomplete Sales', icon: FiAlertTriangle, roles: ['cashier', 'owner', 'manager'] },
  ] },
  { label: 'Station', items: [
    { href: '/admin/fuel/tank-stock', label: 'Tank Dipstick', icon: FiDroplet, roles: ['supervisor'] },
    { href: '/admin/fuel/tanks', label: 'Tanks & Pumps', icon: FiSettings, roles: ['owner', 'manager'] },
    { href: '/admin/fuel/attendant-performance', label: 'Attendants', icon: FiUserCheck, roles: ['owner', 'manager'] },
    { href: '/admin/services', label: 'Branches', icon: FiMapPin, roles: ['owner', 'manager'] },
    { href: '/admin/users', label: 'Users', icon: FiUsers, roles: ['owner', 'manager'] },
  ] },
  { label: 'Review', items: [
    { href: '/admin/fuel/summary-book', label: 'Summary Book', icon: FiBookOpen, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/fuel/collections', label: 'Payment History', icon: FiFileText, roles: ['auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/exceptions', label: 'Flags', icon: FiAlertTriangle, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/audit', label: 'Audit Log', icon: FiShield, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/fuel/backfill', label: 'Historical Backfill', icon: FiClock, roles: ['owner'] },
    { href: '/admin/billing', label: 'Subscription', icon: FiCreditCard, roles: ['owner'] },
  ] },
];
const HISTORICAL_FUEL_GROUPS = [
  { label: 'Historical review', items: [
    { href: '/admin/fuel/dashboard', label: 'Dashboard', icon: FiHome },
    { href: '/admin/fuel/summary-book', label: 'Summary Book', icon: FiBookOpen },
    { href: '/admin/fuel/historical-incomplete', label: 'Incomplete Sales', icon: FiAlertTriangle, roles: ['owner', 'manager', 'cashier'] },
    { href: '/admin/fuel/attendant-performance', label: 'Attendants', icon: FiUserCheck, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/exceptions', label: 'Flags', icon: FiShield, roles: ['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'] },
    { href: '/admin/users', label: 'Users', icon: FiUsers, roles: ['owner', 'manager'] },
    { href: '/admin/billing', label: 'Subscription', icon: FiCreditCard, roles: ['owner'] },
  ] },
];

export default function Sidebar({ services = [], businessType, user }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [unreadChats, setUnreadChats] = useState(0);

  const canSeeChat = ['owner', 'manager', 'materials_manager'].includes(user?.role);
  useEffect(() => {
    if (!canSeeChat) return;
    const load = () => fetch('/api/admin/chat/unread-count').then((r) => r.json()).then((d) => { if (d.success) setUnreadChats(d.data.count); });
    load();
    const t = setInterval(load, CHAT_POLL_MS);
    return () => clearInterval(t);
  }, [canSeeChat]);
  // Every page under /admin reads its working service/branch from the URL (ServiceBranchSwitcher) —
  // a sidebar link that dropped those params would force a re-pick on every single navigation. Only
  // service/branch carry forward; anything else a page put in the URL (e.g. a tab) shouldn't leak
  // into an unrelated destination.
  const carry = new URLSearchParams();
  if (searchParams.get('service')) carry.set('service', searchParams.get('service'));
  if (searchParams.get('branch')) carry.set('branch', searchParams.get('branch'));
  const qs = carry.toString();
  const withParams = (href) => href === '/admin/customers' ? href : (qs ? `${href}?${qs}` : href);

  // No service selected (a multi-service org on "All services") means no single business is
  // "current" — pack items stay hidden rather than showing every business at once; a single-service
  // org's only service auto-selects almost immediately (ServiceBranchSwitcher), so this is only ever
  // the real state for a deliberate "All services" view.
  const currentServiceId = searchParams.get('service') || '';
  const currentServiceType = services.find((s) => s.id === currentServiceId)?.type || businessType || null;

  const historicalFuel = currentServiceType === 'fuel_station' && services.some((service) => service.config?.migrationStockPending === true);
  const menu = historicalFuel ? HISTORICAL_FUEL_GROUPS : currentServiceType === 'fuel_station' ? FUEL_GROUPS : GROUPS;
  const groups = menu.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.pack || item.pack === currentServiceType) && (!item.roles || item.roles.includes(user?.role)) && (services.length > 0 || ['/admin/billing', '/admin/services', '/admin/users'].includes(item.href))),
  })).filter((g) => g.items.length > 0);
  return (
    <>
    <nav className="print:hidden w-56 shrink-0 border-r bg-white p-4 hidden md:block">
      {groups.map((group) => (
        <div key={group.label} className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-3">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={withParams(item.href)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                      active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon size={16} className={active ? 'text-brand-600' : 'text-gray-400'} />
                    {item.label}
                    {item.href === '/admin/messages' && unreadChats > 0 && (
                      <span className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-medium flex items-center justify-center">
                        {unreadChats > 99 ? '99+' : unreadChats}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
    <nav aria-label="Mobile navigation" className="print:hidden fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t bg-white px-2 py-2 md:hidden">
      {groups.flatMap((group) => group.items).map((item) => {
        const Icon = item.icon;
        return <Link key={`${item.href}-${item.label}`} href={withParams(item.href)} className={`flex min-w-[5rem] flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-center text-[11px] ${pathname === item.href ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600'}`}>
          <Icon size={18} /><span>{item.label}</span>
        </Link>;
      })}
    </nav>
    </>
  );
}
