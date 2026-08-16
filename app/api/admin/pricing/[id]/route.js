import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Owner-only (can('pricing.approve') resolves true only for owner's '*' wildcard — no manager/staff
// entry grants it). Approving actually applies the price now (closes the current PriceRule, opens
// the new one) — the live price was never touched when the proposal was created.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'pricing.approve')) {
    return NextResponse.json({ error: 'You do not have permission to approve price changes' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const decision = body.status; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(decision)) throw new ApiError('Invalid decision', 400);
    await verifyOtp({ userId: session.user.id, purpose: 'price_approval', code: body.otp });

    const updated = await prisma.$transaction(async (tx) => {
      const history = await tx.priceHistory.findUnique({ where: { id } });
      if (!history) throw new ApiError('Not found', 404);
      if (history.status !== 'pending') throw new ApiError('This price change has already been decided', 400);

      if (decision === 'approved') {
        const current = await tx.priceRule.findFirst({ where: { productId: history.productId, validTo: null }, orderBy: { validFrom: 'desc' } });
        if (current) await tx.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
        await tx.priceRule.create({ data: { productId: history.productId, price: history.newPrice, createdBy: history.changedBy } });
      }

      return tx.priceHistory.update({
        where: { id }, data: { status: decision, approvedBy: session.user.id, approvedAt: new Date(), adminNote: body.adminNote || null },
      });
    }, { timeout: 15000 });

    if (updated.changedBy) {
      const product = await prisma.product.findUnique({ where: { id: updated.productId } });
      await notify({
        recipientUserId: updated.changedBy, type: 'price_decided',
        title: decision === 'approved' ? 'Price change approved' : 'Price change rejected',
        message: `Your proposed price change for ${product?.name || 'a product'} was ${decision}`,
        relatedType: 'Product', relatedId: updated.productId,
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
