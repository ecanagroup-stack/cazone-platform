import { guardBranchParam } from '@/lib/branchParam';
import AttendantPerformancePage from './PageClient';

// Server wrapper: swaps a ?branch= the caller may not open for one they can before the client page renders.
export default async function Page({ searchParams }) {
  await guardBranchParam('/admin/fuel/attendant-performance', searchParams);
  return <AttendantPerformancePage />;
}
