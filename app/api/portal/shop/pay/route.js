import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { priceLines } from '@/lib/sale';
import { ApiError } from '@/lib/apiError';

// Prepares a customer's Shop cart for immediate payment — an alternative to the default "Place
// Order" (which goes on credit and sits pending for staff to confirm, app/api/portal/shop/orders).
// Prices the cart the exact same way createPendingOrder does (this customer's own negotiated rates,
// their standing transportRate) purely to show/charge the right total NOW; the order itself isn't
// created here at all. The client (app/portal/shop/page.js) carries branchId/lines/transportFee in
// the Paystack `metadata` it hands to PaystackButton itself — only once the webhook
// (app/api/webhooks/paystack, metadata.type === 'shop_order') confirms the charge does it call
// createSaleOrder, which re-prices independently from that metadata (price is never trusted from an
// old computation, same rule as everywhere else — core-algorithms skill §1).
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { paymentsEnabled: true, paystackSubaccountCode: true },
    });
    if (!org?.paymentsEnabled || !org.paystackSubaccountCode) {
      throw new ApiError('This organization isn\'t set up to collect payments online', 400);
    }

    const body = await request.json();
    const { branchId, lines } = body;
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('Add at least one product', 400);

    const access = await prisma.customerAccess.findUnique({ where: { customerId_branchId: { customerId: session.user.customerId, branchId } } });
    if (!access) throw new ApiError('You\'re not registered at this branch', 400);

    const customer = await prisma.customer.findUnique({ where: { id: session.user.customerId }, select: { email: true, transportRate: true } });
    const { subtotal } = await priceLines(lines, session.user.customerId);
    const transportFee = customer?.transportRate || 0;
    const amountKobo = subtotal + transportFee;

    const email = customer.email || `customer-${session.user.customerId}@cazone.app`;
    const reference = `shop_${session.user.customerId}_${Date.now()}`;

    return NextResponse.json({ success: true, data: { reference, amountKobo, email, subaccountCode: org.paystackSubaccountCode } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
