import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

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
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}) } } : {}),
      },
      include: { customer: true, lines: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json({ success: true, data: orders });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
