import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { resolvePrice } from '@/lib/pricing';
import { checkCredit } from '@/lib/credit';
import { ApiError } from '@/lib/apiError';

// The materials counter's checkout. Unlike the fuel pack's shift-aggregate sale, this is a real
// itemized transaction: resolves each line's price (lib/pricing.js), runs a credit check when the
// customer is paying on account (lib/credit.js — never hard-blocks, returns the exact shortfall),
// then in one transaction creates the Order+OrderLines, one StockMove per line, updates the
// customer's balance for credit sales, and raises a Flag if a credit shortfall was overridden.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const customerId = body.customerId || null;
    const paymentMethod = body.paymentMethod || 'cash';
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const overrideCredit = !!body.overrideCredit;

    if (!branchId) throw new ApiError('branchId is required', 400);
    if (lines.length === 0) throw new ApiError('Add at least one product', 400);
    if (paymentMethod === 'credit' && !customerId) throw new ApiError('A customer is required for a credit sale', 400);

    const priced = [];
    let subtotal = 0;
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!line.productId || !Number.isFinite(qty) || qty <= 0) throw new ApiError('Every line needs a product and a positive quantity', 400);
      const { price, priceRuleId } = await resolvePrice(line.productId);
      const lineTotal = Math.round(qty * price);
      subtotal += lineTotal;
      priced.push({ productId: line.productId, qty, unitPrice: price, lineTotal, priceRuleId });
    }
    const grandTotal = subtotal;

    let creditFlag = false;
    if (paymentMethod === 'credit') {
      const decision = await checkCredit({ customerId, orderTotal: grandTotal });
      if (decision.decision === 'blocked') {
        throw new ApiError(decision.reason || 'This customer cannot be sold to on credit', 400);
      }
      if (decision.decision === 'needsApproval' && !overrideCredit) {
        return NextResponse.json({
          success: false, needsApproval: true,
          shortfall: decision.shortfall, exposure: decision.exposure, available: decision.available,
          error: `This exceeds the customer's credit limit by ${(decision.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
        });
      }
      if (decision.decision === 'needsApproval' && overrideCredit) creditFlag = true;
    }

    const order = await prisma.$transaction(async (tx) => {
      const counter = await tx.counter.upsert({
        where: { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } },
        update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
      });
      const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

      const created = await tx.order.create({
        data: {
          branchId, customerId, orderNumber, subtotal, grandTotal, paymentMethod, createdBy: session.user.id,
          lines: { create: priced.map((p) => ({ productId: p.productId, priceRuleId: p.priceRuleId, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal })) },
        },
        include: { lines: true },
      });

      for (const p of priced) {
        await tx.stockMove.create({ data: { branchId, productId: p.productId, qty: -p.qty, reason: 'sale', ref: created.id, userId: session.user.id } });
      }

      if (customerId && paymentMethod === 'credit') {
        await tx.customer.update({ where: { id: customerId }, data: { balance: { increment: grandTotal } } });
      }

      if (creditFlag) {
        await tx.flag.create({
          data: {
            branchId, targetType: 'Order', targetId: created.id, severity: 'concern', classification: 'concern',
            reason: `Credit sale ${created.orderNumber} overrode the customer's credit limit`, raisedBy: session.user.id,
          },
        });
      }

      return created;
    });

    return NextResponse.json({ success: true, data: { order, flagged: creditFlag } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
