import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { autoArriveDueAllocations } from '@/lib/allocation';
import { ApiError } from '@/lib/apiError';

// Sellable allocations (loaded or arrived, qtyRemaining > 0) for a branch — what the counter/portal
// checkout offers as "sell from this batch" per product, alongside ordinary on-hand stock.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);

    await autoArriveDueAllocations();

    const allocations = await prisma.delivery.findMany({
      where: { branchId, status: { in: ['loaded', 'arrived'] }, qtyRemaining: { gt: 0 } },
      include: { supplier: true, product: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ success: true, data: allocations });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
