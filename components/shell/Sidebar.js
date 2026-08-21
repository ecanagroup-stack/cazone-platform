'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  FiHome, FiAlertTriangle, FiDroplet, FiShoppingCart, FiUsers, FiTruck, FiSettings, FiBox,
  FiMapPin, FiUserCheck, FiCreditCard, FiBarChart2, FiSliders, FiLayers, FiMap, FiFileText,
  FiCheckCircle, FiBookOpen, FiClock, FiShield,
} from 'react-icons/fi';

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
      { href: '/admin/materials/counter', label: 'Cement Warehouse', icon: FiShoppingCart, pack: 'shop' },
      { href: '/admin/materials/sales/new/cement', label: 'Cement Sale', icon: FiFileText, pack: 'shop' },
      { href: '/admin/materials/sales/new/stonedust', label: 'Aggregate Sale', icon: FiFileText, pack: 'shop' },
      { href: '/admin/retail/counter', label: 'Retail Counter', icon: FiShoppingCart, pack: 'general_store' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/admin/customers', label: 'Customers', icon: FiUsers },
      { href: '/admin/deliveries', label: 'Deliveries', icon: FiTruck },
      { href: '/admin/fuel/tanks', label: 'Fuel Setup', icon: FiSettings, pack: 'fuel_station' },
      { href: '/admin/fuel/backfill', label: 'Historical Backfill', icon: FiClock, pack: 'fuel_station' },
      { href: '/admin/materials/cement-brands', label: 'Cement Brands', icon: FiBox, pack: 'shop' },
      { href: '/admin/materials/stonedust', label: 'Aggregate', icon: FiLayers, pack: 'shop' },
      { href: '/admin/materials/quarries', label: 'Quarries', icon: FiMap, pack: 'shop' },
      { href: '/admin/materials/trucks', label: 'Trucks', icon: FiTruck, pack: 'shop' },
      { href: '/admin/materials/atcs', label: 'ATCs', icon: FiFileText, pack: 'shop' },
      { href: '/admin/retail/products', label: 'Retail Products', icon: FiBox, pack: 'general_store' },
      { href: '/admin/services', label: 'Services & Branches', icon: FiMapPin },
      { href: '/admin/users', label: 'Users', icon: FiUserCheck },
      { href: '/admin/price-approvals', label: 'Price Approvals', icon: FiCheckCircle },
      { href: '/admin/billing', label: 'Billing', icon: FiCreditCard },
      { href: '/admin/settings', label: 'Settings', icon: FiSliders },
    ],
  },
  {
    label: 'Know',
    items: [
      { href: '/admin', label: 'Today', icon: FiHome },
      { href: '/admin/exceptions', label: 'Anything Wrong', icon: FiAlertTriangle },
      { href: '/admin/reports', label: 'Reports', icon: FiBarChart2 },
      { href: '/admin/fuel/attendant-performance', label: 'Attendant Performance', icon: FiBarChart2, pack: 'fuel_station' },
      { href: '/admin/fuel/summary-book', label: 'Summary Book', icon: FiBookOpen, pack: 'fuel_station' },
      { href: '/admin/audit', label: 'Audit Log', icon: FiShield },
    ],
  },
];

export default function Sidebar({ services = [] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Every page under /admin reads its working service/branch from the URL (ServiceBranchSwitcher) —
  // a sidebar link that dropped those params would force a re-pick on every single navigation. Only
  // service/branch carry forward; anything else a page put in the URL (e.g. a tab) shouldn't leak
  // into an unrelated destination.
  const carry = new URLSearchParams();
  if (searchParams.get('service')) carry.set('service', searchParams.get('service'));
  if (searchParams.get('branch')) carry.set('branch', searchParams.get('branch'));
  const qs = carry.toString();
  const withParams = (href) => (qs ? `${href}?${qs}` : href);

  // No service selected (a multi-service org on "All services") means no single business is
  // "current" — pack items stay hidden rather than showing every business at once; a single-service
  // org's only service auto-selects almost immediately (ServiceBranchSwitcher), so this is only ever
  // the real state for a deliberate "All services" view.
  const currentServiceId = searchParams.get('service') || '';
  const currentServiceType = services.find((s) => s.id === currentServiceId)?.type || null;

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.pack || item.pack === currentServiceType),
  })).filter((g) => g.items.length > 0);
  return (
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
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
