import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { allocatePayment } from '@/lib/payments';
import { notifyAlteration, customerBranchIds } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { optionalBusinessDate } from '@/lib/saleDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, backdatedNotice } from '@/lib/backdating';

const PAYMENT_METHODS = ['cash', 'transfer', 'pos', 'cheque'];

// Taking a payment is counter work (sales.record), same as ringing up a sale — no reason a cashier
// can't do this, unlike changing a credit limit which stays manager-only (customers.manage).
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a payment' }, { status: 403 });
  }
  try {
    const { id: customerId } = await params;
    const body = await request.json();
    const amount = Math.round(Number(body.amount));
    const method = body.method || 'cash';
    if (!PAYMENT_METHODS.includes(method)) throw new ApiError('Choose a valid payment method', 400);
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Payment amount must be positive', 400);
    const paymentDate = optionalBusinessDate(body.paymentDate, 'Payment date');
    assertBackdateOtpPresent(paymentDate, body.backdateOtp);

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const backdated = await requireBackdateOtp({ userId: session.user.id, date: paymentDate, otp: body.backdateOtp });

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { customerId, amount, method, reference: (body.reference || '').trim() || null, recordedBy: session.user.id, paymentDate },
      });
      const { allocations, unallocated } = await allocatePayment(tx, {
        customerId, paymentId: payment.id, amount, orderIds: body.orderIds, paymentDate: paymentDate?.toISOString().slice(0, 10),
      });
      await tx.customer.update({ where: { id: customerId }, data: { balance: { decrement: amount } } });
      return { payment, allocations, unallocated };
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    const notice = {
      actor: session.user, branchIds: await customerBranchIds(customerId), type: 'payment_recorded', title: 'Customer payment recorded',
      message: `${session.user.name} recorded a ${method} payment of ${(amount / 100).toLocaleString()} for ${customer.name}.`,
      relatedType: 'Payment', relatedId: result.payment.id,
    };
    await notifyAlteration(backdated ? backdatedNotice(notice, paymentDate) : notice);

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
