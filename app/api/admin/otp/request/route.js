import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { requestOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

const VALID_PURPOSES = ['credit_override', 'price_approval', 'backfill'];

export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    const body = await request.json();
    const purpose = body.purpose;
    if (!VALID_PURPOSES.includes(purpose)) throw new ApiError('Invalid purpose', 400);

    await requestOtp({ organizationId: session.user.organizationId, userId: session.user.id, purpose });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
