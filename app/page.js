import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';

export default async function RootPage() {
  const session = await getOrgSession();
  if (!session) redirect('/login');
  if (session.user.role === 'super_admin') redirect('/platform/organizations');
  redirect('/admin');
}
