import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { dateRangeWhere, effectiveDate } from '@/lib/businessDates.mjs';

// Cement Warehouse's "Sales History" tab — raw Order rows (not the aggregated report), channel:'shop'
// only, so a mixed materials branch doesn't show its ATC/cement sales here too.
export const GET = withOrg(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!branchId) throw new ApiError('branchId is required', 400);

    const orders = await prisma.order.findMany({
      where: {
        branchId, channel: 'shop',
        ...dateRangeWhere('saleDate', { from, to }),
      },
      include: { customer: true, lines: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const data = orders.map((order) => ({ ...order, businessDate: effectiveDate(order, 'saleDate') }))
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
