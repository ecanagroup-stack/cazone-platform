import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { requireRecordBranch } from '@/lib/branchAccess';

// Fix a mistake in a bank deposit record — no stock/order ledger involved, so this is the simplest
// of the correction routes (compare app/api/admin/fuel/shift/.../correct/route.js for the ledger
// case). Same gate as deciding the deposit in the first place.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'exceptions.manage')) {
    return NextResponse.json({ error: 'You do not have permission to correct a deposit' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required to correct a deposit', 400);

    const deposit = await prisma.cashDeposit.findUnique({ where: { id } });
    await requireRecordBranch(session, deposit, 'Deposit not found');

    const newAmount = body.amount !== undefined ? Math.round(Number(body.amount)) : deposit.amount;
    if (!Number.isFinite(newAmount) || newAmount <= 0) throw new ApiError('Amount must be a positive number', 400);
    const newBankName = body.bankName !== undefined ? (body.bankName || '').trim() || null : deposit.bankName;
    const newAccountNumber = body.accountNumber !== undefined ? (body.accountNumber || '').trim() || null : deposit.accountNumber;

    const updated = await prisma.cashDeposit.update({
      where: { id }, data: { amount: newAmount, bankName: newBankName, accountNumber: newAccountNumber },
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'deposit.corrected', entityType: 'CashDeposit', entityId: id,
      before: { amount: deposit.amount, bankName: deposit.bankName, accountNumber: deposit.accountNumber },
      after: { amount: newAmount, bankName: newBankName, accountNumber: newAccountNumber, reason },
    });

    await notifyAlteration({
      actor: session.user, branchId: deposit.branchId, type: 'deposit_corrected', title: 'Deposit corrected',
      message: `${session.user.name} corrected a deposit from ${(deposit.amount / 100).toLocaleString()} to ${(newAmount / 100).toLocaleString()}. Reason: ${reason}`,
      relatedType: 'CashDeposit', relatedId: id,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
