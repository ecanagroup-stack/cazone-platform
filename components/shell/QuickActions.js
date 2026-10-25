'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FiMessageSquare, FiShoppingBag, FiBarChart2, FiBell } from 'react-icons/fi';
import { CountBadge } from '@/components/portal/PortalCountsProvider';
import { useAdminCounts } from './AdminCountsProvider';

// CHAT / ORDERS / TRANSACTION / ANNOUNCEMENT, on every admin page for the roles that run customers.
// TRANSACTION and ANNOUNCEMENT are plain links with no badge. ORDERS only exists for businesses that
// take portal orders (a fuel distributor's customers buy ATCs instead).
export default function QuickActions({ hasOrdering }) {
  const searchParams = useSearchParams();
  const { chat, pendingOrders } = useAdminCounts();

  // Same carry-forward as the sidebar: keep the working service/branch across navigation.
  const withParams = (href, extra = {}) => {
    const params = new URLSearchParams();
    for (const key of ['service', 'branch']) if (searchParams.get(key)) params.set(key, searchParams.get(key));
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    const qs = params.toString();
    return qs ? `${href}?${qs}` : href;
  };

  const actions = [
    { label: 'CHAT', href: withParams('/admin/messages'), icon: FiMessageSquare, count: chat, badgeLabel: 'chats' },
    ...(hasOrdering ? [{ label: 'ORDERS', href: withParams('/admin/orders'), icon: FiShoppingBag, count: pendingOrders, badgeLabel: 'pending orders', unread: false }] : []),
    { label: 'TRANSACTION', href: withParams('/admin/reports'), icon: FiBarChart2 },
    { label: 'ANNOUNCEMENT', href: withParams('/admin/messages', { announce: '1' }), icon: FiBell },
  ];

  return (
    <nav aria-label="Quick actions" className="print:hidden border-b bg-gray-50 px-4 py-2">
      <ul className="mx-auto flex max-w-6xl gap-2 overflow-x-auto">
        {actions.map(({ label, href, icon: Icon, count, badgeLabel, unread }) => (
          <li key={label} className="min-w-0 flex-1 sm:flex-none">
            <Link href={href} className="flex items-center justify-center gap-2 rounded-lg border bg-white px-4 py-2 text-xs font-semibold tracking-wide text-gray-700 hover:border-brand-500 hover:text-brand-700">
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
              {count > 0 && <CountBadge count={count} label={badgeLabel} unread={unread} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
