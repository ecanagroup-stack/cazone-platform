import { notFound } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { getOrgCustomerFlags } from '@/lib/orgLookup';

// Buying ATCs exists only for customers of a fuel station whose distributor add-on is active right now;
// read live so a lapsed add-on makes the page disappear at once.
export default async function PortalAtcLayout({ children }) {
  const session = await getOrgSession();
  if (session?.user?.role !== 'customer' || !session.user.organizationId) notFound();
  const { hasCustomers, hasAtc } = await getOrgCustomerFlags(session.user.organizationId);
  if (!hasCustomers || !hasAtc) notFound();
  return children;
}
