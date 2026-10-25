import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { dateRangeWhere, effectiveDate, lagosDayRange } from '@/lib/businessDates.mjs';

// Closed shifts' cash-up plus bank deposits for the range — what the old fuel app's financial-daily
// report covered, generically (any pack running shifts, not just fuel). Pass serviceId instead of
// branchId to roll every branch of that service into one report — rows then carry a branch name.
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const serviceId = url.searchParams.get('serviceId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId && !serviceId) throw new ApiError('branchId or serviceId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const range = lagosDayRange({ from, to });
    const branchWhere = branchId ? { id: branchId } : { serviceId };
    const branches = await prisma.branch.findMany({ where: branchWhere, select: { id: true, name: true } });
    const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const allBranches = !branchId;
    const branchIds = branches.map((b) => b.id);

    const [shifts, deposits] = await Promise.all([
      prisma.shift.findMany({ where: { branchId: { in: branchIds }, status: 'closed', closedAt: range }, orderBy: { closedAt: 'desc' } }),
      prisma.cashDeposit.findMany({ where: { branchId: { in: branchIds }, ...dateRangeWhere('depositDate', { from, to }) }, orderBy: { createdAt: 'desc' } }),
    ]);

    const withBranch = (rows) => rows.map((r) => ({ ...r, branch: branchNameById[r.branchId] || '—' }));
    const depositRows = withBranch(deposits).map((d) => ({ ...d, businessDate: effectiveDate(d, 'depositDate') }))
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate));

    return NextResponse.json({ success: true, data: { shifts: withBranch(shifts), deposits: depositRows }, allBranches });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
