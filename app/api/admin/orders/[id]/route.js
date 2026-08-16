import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// One order, fully populated for a printable receipt (app/admin/orders/[id]/receipt) — any signed-in
// staff member can view it, same as they could see it in a report; nothing here is role-gated beyond
// org membership. Org profile fields (logo, address, invoice footer, bank details) come along too so
// the receipt page doesn't need a second round trip.
export const GET = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  try {
    const { id } = await params;
    const [order, organization] = await Promise.all([
      prisma.order.findUnique({
        where: { id },
        include: {
          branch: true,
          customer: true,
          lines: { include: { product: true } },
        },
      }),
      prisma.organization.findUnique({ where: { id: session.user.organizationId } }),
    ]);
    if (!order) throw new ApiError('Order not found', 404);

    return NextResponse.json({ success: true, data: { order, organization } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
