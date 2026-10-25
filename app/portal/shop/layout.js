import { notFound } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { getOrgCustomerFlags } from '@/lib/orgLookup';

// Shared by /portal/shop and its /portal/order alias (re-exported from app/portal/order/layout.js) so
// both are gated by the same rule: goods ordering exists for shops and general stores only.
export default async function PortalOrderLayout({ children }) {
  const session = await getOrgSession();
  if (session?.user?.role !== 'customer' || !session.user.organizationId) notFound();
  const { hasCustomers, hasOrdering } = await getOrgCustomerFlags(session.user.organizationId);
  if (!hasCustomers || !hasOrdering) notFound();
  return children;
}
