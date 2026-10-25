import { notFound } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';

// The layout above only hides the nav link; this keeps a role without atc.view from opening the page by URL.
export default async function Layout({ children }) {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.view')) notFound();
  return children;
}
