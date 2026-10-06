import { redirect } from 'next/navigation';

// Station staff are login users. Keep the original app's Staff URL as an entry point, but use
// the same list and management actions as Users so neither screen can drift from the other.
export default async function FuelStaffPage({ searchParams }) {
  const params = await searchParams;
  const query = new URLSearchParams({ view: 'staff' });
  if (params?.service) query.set('service', params.service);
  if (params?.branch) query.set('branch', params.branch);
  redirect(`/admin/users?${query.toString()}`);
}
