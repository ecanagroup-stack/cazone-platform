import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Small, scoped customer lookup shared by any pack's sale-recording picker (materials counter, fuel
// credit fills) — not the full customer-management screen. Strictly filtered to customers with
// CustomerAccess for the caller's current branch: a customer not tagged there isn't a valid sale
// target from there, matching "branch bound and business bound... independent" — see
// app/api/admin/customers/route.js for the org-wide management list this deliberately isn't.
export const GET = withOrg(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const branchId = searchParams.get('branchId');
    if (q.length < 2) return NextResponse.json({ success: true, data: [] });
    if (!branchId) throw new ApiError('branchId is required', 400);

    const customers = await prisma.customer.findMany({
      where: {
        isActive: true,
        access: { some: { branchId } },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { businessName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ success: true, data: customers });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
