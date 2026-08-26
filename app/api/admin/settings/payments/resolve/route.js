import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { resolveAccountNumber } from '@/lib/paystack';
import { ApiError } from '@/lib/apiError';

// Step one of enabling payment collection: confirm the account number really resolves to a real
// account before the owner commits to it (see app/api/admin/settings/payments POST) — never create
// the subaccount from a typed, unverified account name.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') {
    return NextResponse.json({ error: 'Only the organization owner can manage payment collection' }, { status: 403 });
  }
  try {
    const { bankCode, accountNumber } = await request.json();
    if (!bankCode || !accountNumber) throw new ApiError('Bank and account number are required', 400);
    const { accountName } = await resolveAccountNumber(accountNumber, bankCode);
    return NextResponse.json({ success: true, data: { accountName } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
