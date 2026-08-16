import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Closed shifts' cash-up plus bank deposits for the range — what the old fuel app's financial-daily
// report covered, generically (any pack running shifts, not just fuel).
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const range = { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) };

    const [shifts, deposits] = await Promise.all([
      prisma.shift.findMany({ where: { branchId, status: 'closed', closedAt: range }, orderBy: { closedAt: 'desc' } }),
      prisma.cashDeposit.findMany({ where: { branchId, createdAt: range }, orderBy: { createdAt: 'desc' } }),
    ]);

    return NextResponse.json({ success: true, data: { shifts, deposits } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
