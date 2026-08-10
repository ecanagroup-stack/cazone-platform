import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { allocatePayment } from '@/lib/payments';
import { ApiError } from '@/lib/apiError';

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
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Payment amount must be positive', 400);

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { customerId, amount, method, reference: (body.reference || '').trim() || null, recordedBy: session.user.id },
      });
      const { allocations, unallocated } = await allocatePayment(tx, {
        customerId, paymentId: payment.id, amount, orderIds: body.orderIds,
      });
      await tx.customer.update({ where: { id: customerId }, data: { balance: { decrement: amount } } });
      return { payment, allocations, unallocated };
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
