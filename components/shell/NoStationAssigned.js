import { Card } from '@/components/ui';

// Shown instead of a page when the signed-in staff member has no branch they may open: their account has
// no UserBranchAccess rows (lib/branchAccess.js fails closed). Only an Admin can give them one.
export default function NoStationAssigned({ fuel = true }) {
  const place = fuel ? 'station' : 'branch';
  return (
    <div className="max-w-xl">
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-gray-900">No {place} assigned</h1>
        <p className="mt-2 text-sm text-gray-600">Your account is not linked to any {place} yet, so there is nothing for you to open. Ask the Admin to assign you to a {place}, then refresh this page.</p>
      </Card>
    </div>
  );
}
