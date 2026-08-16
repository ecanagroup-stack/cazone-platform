import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Org-wide, not branch-filtered — same convention as the exceptions/flags list.
export const GET = withOrg(async () => {
  const deposits = await prisma.cashDeposit.findMany({
    include: { branch: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ success: true, data: deposits });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a deposit' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const amount = Math.round(Number(body.amount));
    const bankName = (body.bankName || '').trim();
    const accountNumber = (body.accountNumber || '').trim();
    const shiftId = body.shiftId || null;

    if (!branchId) throw new ApiError('Branch is required', 400);
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Amount must be positive', 400);
    if (!bankName || !accountNumber) throw new ApiError('Bank name and account number are required', 400);

    const deposit = await prisma.cashDeposit.create({
      data: { branchId, shiftId, amount, bankName, accountNumber, initiatedBy: session.user.id, status: 'pending' },
      include: { branch: true },
    });

    await notify({
      recipientRole: 'owner', type: 'deposit_submitted', title: 'New deposit to approve',
      message: `A deposit of ${(amount / 100).toLocaleString()} for ${deposit.branch.name} needs approval`,
      relatedType: 'CashDeposit', relatedId: deposit.id,
    });

    return NextResponse.json({ success: true, data: deposit }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
