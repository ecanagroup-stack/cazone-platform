import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { optionalBusinessDate } from '@/lib/saleDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, backdatedNotice } from '@/lib/backdating';
import { getAccessibleBranchIds, canAccessBranch, branchScope } from '@/lib/branchAccess';

// Org-wide for the Admin; everyone else sees only the deposits of the stations they handle.
export const GET = withOrg(async () => {
  const access = await getAccessibleBranchIds(await getOrgSession());
  const deposits = await prisma.cashDeposit.findMany({
    where: branchScope(access),
    include: { branch: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ success: true, data: deposits });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record') && !can(session.user.role, 'deposits.record')) {
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
    // The branch comes from the client: it must be one in this organization that the user handles.
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || !canAccessBranch(await getAccessibleBranchIds(session), branchId)) throw new ApiError('Branch not found', 404);
    const shift = shiftId ? await prisma.shift.findUnique({ where: { id: shiftId } }) : null;
    if (shiftId && (!shift || shift.branchId !== branchId)) throw new ApiError('Shift does not belong to this branch', 400);
    const depositDate = optionalBusinessDate(body.depositDate, 'Deposit date');
    // Cash can't be banked before the shift that earned it.
    if (depositDate && shift?.operatingDate && depositDate.toISOString().slice(0, 10) < shift.operatingDate) throw new ApiError('Deposit date cannot be before the shift date', 400);
    assertBackdateOtpPresent(depositDate, body.backdateOtp);
    const backdated = await requireBackdateOtp({ userId: session.user.id, date: depositDate, otp: body.backdateOtp });

    const deposit = await prisma.cashDeposit.create({
      data: { branchId, shiftId, operatingDate: shift?.operatingDate || null, amount, bankName, accountNumber, initiatedBy: session.user.id, status: 'pending', depositDate },
      include: { branch: true },
    });

    const notice = {
      actor: session.user, branchId, type: 'deposit_submitted', title: 'New deposit awaiting approval',
      message: `${session.user.name} submitted a deposit of ${(amount / 100).toLocaleString()} for ${deposit.branch.name}, awaiting Admin approval`,
      relatedType: 'CashDeposit', relatedId: deposit.id,
    };
    await notifyAlteration(backdated ? backdatedNotice(notice, depositDate) : notice);

    return NextResponse.json({ success: true, data: deposit }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
