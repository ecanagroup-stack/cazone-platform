import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { buildCustomerStatement } from '@/lib/statement';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const { ledger, buckets } = await buildCustomerStatement(session.user.customerId);
    return NextResponse.json({ success: true, data: { ledger, buckets } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
