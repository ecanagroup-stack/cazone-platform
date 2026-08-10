'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Same three groups, same order, for every vertical (platform-ui skill, section 1). Sell holds the
// counter itself — one entry per pack, not a list of pages. Manage gets at most two items per pack.
// Hardcoded per-pack for now (only one pack exists); once a second pack lands this should switch to
// reading the org's enabled services instead of a static array.
const GROUPS = [
  {
    label: 'Sell',
    items: [
      { href: '/admin/fuel/shift', label: 'Pumps' },
      { href: '/admin/materials/counter', label: 'Counter' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/admin/services', label: 'Services & Branches' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/billing', label: 'Billing' },
      { href: '/admin/customers', label: 'Customers' },
      { href: '/admin/materials/suppliers', label: 'Suppliers' },
      { href: '/admin/deliveries', label: 'Deliveries' },
      { href: '/admin/fuel/tanks', label: 'Tanks & Dispensers' },
      { href: '/admin/fuel/attendants', label: 'Attendants' },
      { href: '/admin/materials/products', label: 'Products' },
    ],
  },
  {
    label: 'Know',
    items: [
      { href: '/admin', label: 'Today' },
      { href: '/admin/exceptions', label: 'Anything Wrong' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="w-56 shrink-0 border-r bg-white p-4 hidden md:block">
      {GROUPS.filter((g) => g.items.length > 0).map((group) => (
        <div key={group.label} className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</p>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-3 py-2 rounded text-sm ${active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
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
