import { notFound } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { getOrgCustomerFlags } from '@/lib/orgLookup';

export default async function Layout({ children }) {
  const session = await getOrgSession();
  if (!session?.user?.organizationId) notFound();
  const { hasCustomers } = await getOrgCustomerFlags(session.user.organizationId);
  if (!hasCustomers) notFound();
  return children;
}
