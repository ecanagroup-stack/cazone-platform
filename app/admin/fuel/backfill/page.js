import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { guardBranchParam } from '@/lib/branchParam';
import BackfillPage from './PageClient';

const HISTORICAL_ROLES = ['owner', 'manager', 'supervisor'];

// Server wrapper: sends anyone outside the historical-entry roles (the cashier has none) back to their
// dashboard, then swaps a ?branch= the caller may not open for one they can before the client page renders.
export default async function Page({ searchParams }) {
  const session = await getOrgSession();
  if (session?.user && !HISTORICAL_ROLES.includes(session.user.role)) redirect('/admin/fuel/dashboard');
  await guardBranchParam('/admin/fuel/backfill', searchParams);
  return <BackfillPage />;
}
