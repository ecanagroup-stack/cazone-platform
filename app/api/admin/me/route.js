import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

// The current staff login's own scope — `accessibleBranchIds: null` means unrestricted (owner, or a
// role with no UserBranchAccess rows). Client-side pickers (e.g. Add Customer's branch checklist)
// use this to not even offer a branch the caller can't act on — the real enforcement is still
// server-side (lib/branchAccess.js's canAccessBranch, checked again on write), this is just so the
// form doesn't dangle options that would be rejected anyway.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const accessibleBranchIds = await getAccessibleBranchIds(session);
  return NextResponse.json({ success: true, data: { accessibleBranchIds } });
});
