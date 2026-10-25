'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The Petroleum Distributor section's own tab strip, so its pages are reachable without a sidebar entry.
export default function DistributorNav({ links }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Petroleum distributor" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {links.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href} href={href}
            className={`whitespace-nowrap border-b-2 -mb-px px-4 py-2 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
