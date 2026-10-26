import { guardBranchParam } from '@/lib/branchParam';
import TankStockPage from './PageClient';

// Server wrapper: swaps a ?branch= the caller may not open for one they can before the client page renders.
export default async function Page({ searchParams }) {
  await guardBranchParam('/admin/fuel/tank-stock', searchParams);
  return <TankStockPage />;
}
