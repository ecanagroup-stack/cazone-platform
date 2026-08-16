import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);
    const where = { branchId };
    if (searchParams.get('activeOnly') === '1') where.isActive = true;
    const terminals = await prisma.posTerminal.findMany({ where, orderBy: { label: 'asc' } });
    return NextResponse.json({ success: true, data: terminals });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage POS terminals' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const label = (body.label || '').trim();
    if (!branchId || !label) throw new ApiError('Branch and label are required', 400);

    const terminal = await prisma.posTerminal.create({
      data: { branchId, label, terminalId: (body.terminalId || '').trim() || null, provider: (body.provider || '').trim() || null },
    });
    return NextResponse.json({ success: true, data: terminal }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
