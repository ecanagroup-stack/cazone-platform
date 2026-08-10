'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FiHome, FiAlertTriangle, FiDroplet, FiShoppingCart, FiUsers, FiTruck, FiSettings, FiBox,
  FiMapPin, FiUserCheck, FiCreditCard,
} from 'react-icons/fi';

// Same three groups, same order, for every vertical (platform-ui skill, section 1). Sell holds the
// counter itself — one entry per pack, not a list of pages. Manage gets at most two items per pack,
// and — per explicit feedback — every item in it must earn a genuinely distinct category; closely
// related sub-features (Attendants under fuel, Suppliers under materials/deliveries) live inside
// their parent page as tabs instead of spending a slot. Hardcoded per-pack for now (only two packs
// exist); once a third lands this should switch to reading the org's enabled services instead of a
// static array.
const GROUPS = [
  {
    label: 'Sell',
    items: [
      { href: '/admin/fuel/shift', label: 'Pumps', icon: FiDroplet },
      { href: '/admin/materials/counter', label: 'Counter', icon: FiShoppingCart },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/admin/customers', label: 'Customers', icon: FiUsers },
      { href: '/admin/deliveries', label: 'Deliveries', icon: FiTruck },
      { href: '/admin/fuel/tanks', label: 'Fuel Setup', icon: FiSettings },
      { href: '/admin/materials/products', label: 'Products', icon: FiBox },
      { href: '/admin/services', label: 'Services & Branches', icon: FiMapPin },
      { href: '/admin/users', label: 'Users', icon: FiUserCheck },
      { href: '/admin/billing', label: 'Billing', icon: FiCreditCard },
    ],
  },
  {
    label: 'Know',
    items: [
      { href: '/admin', label: 'Today', icon: FiHome },
      { href: '/admin/exceptions', label: 'Anything Wrong', icon: FiAlertTriangle },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="w-56 shrink-0 border-r bg-white p-4 hidden md:block">
      {GROUPS.filter((g) => g.items.length > 0).map((group) => (
        <div key={group.label} className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-3">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
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
