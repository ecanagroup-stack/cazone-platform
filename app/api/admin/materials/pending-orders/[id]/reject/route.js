import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { rejectPendingOrder } from '@/lib/sale';

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to reject a sale' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const order = await rejectPendingOrder(id);
    return NextResponse.json({ success: true, data: order });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
