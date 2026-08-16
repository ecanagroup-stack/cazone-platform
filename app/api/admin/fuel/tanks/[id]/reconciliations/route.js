import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Closing Stock history (F4) — Tanks & Dispensers only ever shows the most recent dip inline; this
// is the full run of reconciliations behind it, same (branchId, productId) grain the dip route itself
// reconciles against.
export const GET = withOrg(async (request, { params }) => {
  try {
    const { id: tankId } = await params;
    const tank = await prisma.tank.findUnique({ where: { id: tankId } });
    if (!tank) throw new ApiError('Tank not found', 404);

    const reconciliations = await prisma.reconciliation.findMany({
      where: { branchId: tank.branchId, productId: tank.productId },
      orderBy: { periodEnd: 'desc' },
      take: 100,
    });

    return NextResponse.json({ success: true, data: reconciliations });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
