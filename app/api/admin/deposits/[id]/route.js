import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'exceptions.manage')) {
    return NextResponse.json({ error: 'You do not have permission to approve deposits' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const status = body.status; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(status)) throw new ApiError('Invalid decision', 400);

    const existing = await prisma.cashDeposit.findUnique({ where: { id } });
    if (!existing) throw new ApiError('Not found', 404);
    if (existing.status !== 'pending') throw new ApiError('This deposit has already been decided', 400);

    const updated = await prisma.cashDeposit.update({
      where: { id }, data: { status, approvedBy: session.user.id, note: body.note || null },
      include: { branch: true },
    });

    await notify({
      recipientUserId: updated.initiatedBy, type: 'deposit_decided',
      title: status === 'approved' ? 'Deposit approved' : 'Deposit rejected',
      message: `Your deposit of ${(updated.amount / 100).toLocaleString()} for ${updated.branch.name} was ${status}`,
      relatedType: 'CashDeposit', relatedId: updated.id,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
