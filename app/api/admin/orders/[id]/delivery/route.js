import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { canAccessBranch, getAccessibleBranchIds } from '@/lib/branchAccess';
import { verifyOtp } from '@/lib/otp';
import { notifyReviewers } from '@/lib/notify';
import { checkCredit } from '@/lib/credit';
import { ApiError } from '@/lib/apiError';
import { revisedSaleTotals, allocationReleasePlan, revisedAtcAvailability } from '@/lib/pendingSaleEdit.mjs';
import { materialSaleDates } from '@/lib/saleDates.mjs';

const cents = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || Math.round(number * 100) > Number.MAX_SAFE_INTEGER) {
    throw new ApiError(`${label} must be zero or more`, 400);
  }
  return Math.round(number * 100);
};

const positiveQuantity = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ApiError(`${label} must be positive`, 400);
  return number;
};

// The sale remains booked while goods are in transit. Edits to a pending sale are a single
// transaction: change its invoice, correct stock with append-only moves, and update account credit.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to edit sales' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const revision = Number(body.revision);
    const reason = String(body.reason || '').trim();
    if (!Number.isInteger(revision) || revision < 0) throw new ApiError('Reload this sale before editing it', 409);
    if (reason.length < 5) throw new ApiError('Give a reason for the sale change (at least 5 characters)', 400);
    if (typeof body.delivered !== 'boolean') throw new ApiError('Select a delivery status', 400);
    const { saleDate, deliveryDate } = materialSaleDates(body);
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ApiError('Sale lines are required', 400);

    const accessible = await getAccessibleBranchIds(session);
    const existing = await prisma.order.findUnique({ where: { id }, include: { lines: { include: { costs: true } }, allocations: true, branch: { select: { service: { select: { type: true } } } } } });
    if (!existing || !canAccessBranch(accessible, existing.branchId) || existing.branch.service.type !== 'shop') throw new ApiError('Sale not found', 404);
    if (existing.status !== 'active' || existing.deliveryStatus !== 'pending') throw new ApiError('Only active sales awaiting delivery can be edited', 409);
    if (existing.deliveryRevision !== revision) throw new ApiError('This sale has changed; reload the report', 409);
    if (existing.lines.some((line) => line.stockQty == null)) throw new ApiError('This sale lacks a physical quantity record; use a supervised correction', 409);
    if (body.lines.length !== existing.lines.length) throw new ApiError('Every sale line must be included', 400);

    const incomingById = new Map(body.lines.map((line) => [line.id, line]));
    if (incomingById.size !== existing.lines.length || existing.lines.some((line) => !incomingById.has(line.id))) {
      throw new ApiError('Sale lines do not match this transaction', 400);
    }
    const prepared = existing.lines.map((line) => {
      const input = incomingById.get(line.id);
      const qty = positiveQuantity(input.qty, 'Billed quantity');
      const stockQty = positiveQuantity(input.stockQty, 'Physical quantity');
      const unitPrice = cents(input.unitPrice, 'Unit price');
      const transportFee = cents(input.transportFee, 'Transport fee');
      if (!Array.isArray(input.costs)) throw new ApiError('Sale costs are required', 400);
      const costInputs = new Map(input.costs.map((cost) => [cost.id, cost]));
      if (costInputs.size !== line.costs.length || line.costs.some((cost) => !costInputs.has(cost.id))) {
        throw new ApiError('Sale costs do not match this transaction', 400);
      }
      const costs = line.costs.map((cost) => ({ ...cost, amount: cents(costInputs.get(cost.id).amount, 'Cost amount') }));
      const lineTotal = Math.round(qty * unitPrice);
      if (!Number.isSafeInteger(lineTotal)) throw new ApiError('Sale line total is too large', 400);
      return { line, qty, stockQty, unitPrice, transportFee, costs, lineTotal };
    });
    const discount = cents(body.discount, 'Discount');
    const orderTransportFee = cents(body.orderTransportFee, 'Order transport fee');
    const { subtotal, transportFee, labourFee, otherFee, grandTotal } = revisedSaleTotals(prepared, discount, orderTransportFee);
    if (discount > subtotal) throw new ApiError('Discount cannot exceed the sale subtotal', 400);
    if (!Number.isSafeInteger(grandTotal) || grandTotal <= 0) throw new ApiError('Sale total must be positive', 400);
    const creditIncrease = existing.customerId && existing.paymentMethod === 'credit' && grandTotal > existing.grandTotal;
    let creditOverrideUsed = false;
    if (creditIncrease) {
      const decision = await checkCredit({ customerId: existing.customerId, orderTotal: grandTotal - existing.grandTotal });
      if (decision.decision === 'blocked') throw new ApiError(decision.reason || 'Customer cannot take more credit', 400);
      if (decision.decision === 'needsApproval') {
        if (!body.overrideCredit) return NextResponse.json({ success: false, needsApproval: true, error: `This exceeds the customer's credit limit by ${(decision.shortfall / 100).toLocaleString()}`, shortfall: decision.shortfall });
        await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });
        creditOverrideUsed = true;
      }
    }
    const discountOtpUsed = discount !== existing.discount;
    if (discountOtpUsed) {
      await verifyOtp({ userId: session.user.id, purpose: 'sale_discount', code: body.discountOtp });
    }

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, status: 'active', deliveryStatus: 'pending', deliveryRevision: revision },
        data: { deliveryRevision: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ApiError('This sale has changed; reload the report', 409);

      for (const item of [...prepared].sort((left, right) => (left.stockQty - left.line.stockQty) - (right.stockQty - right.line.stockQty))) {
        const delta = item.stockQty - item.line.stockQty;
        if (delta !== 0) {
          if (item.line.allocationId) {
            const allocation = await tx.delivery.findUnique({ where: { id: item.line.allocationId } });
            if (!allocation || allocation.branchId !== existing.branchId || allocation.productId !== item.line.productId || allocation.qtyRemaining == null) {
              throw new ApiError('The original ATC is unavailable for correction', 409);
            }
            let revised;
            try { revised = revisedAtcAvailability(allocation, delta); }
            catch (error) { throw new ApiError(error.message, 409); }
            await tx.delivery.update({ where: { id: allocation.id }, data: { qtyRemaining: revised.remaining, status: revised.status } });
          } else if (delta > 0) {
            const stock = await tx.stockMove.aggregate({ where: { branchId: existing.branchId, productId: item.line.productId }, _sum: { qty: true } });
            if ((stock._sum.qty || 0) < delta) throw new ApiError('Insufficient stock for the revised physical quantity', 409);
          }
          await tx.stockMove.create({ data: {
            branchId: existing.branchId, productId: item.line.productId, qty: -delta,
            reason: 'adjustment', ref: id, userId: session.user.id, channel: item.line.allocationId ? 'atc' : existing.channel,
            note: `Pending sale ${existing.orderNumber} correction: ${reason}`,
          } });
        }
        await tx.orderLine.update({ where: { id: item.line.id }, data: {
          qty: item.qty, stockQty: item.stockQty, unitPrice: item.unitPrice,
          lineTotal: item.lineTotal, transportFee: item.transportFee,
        } });
        for (const cost of item.costs) {
          if (cost.amount !== item.line.costs.find((old) => old.id === cost.id).amount) {
            await tx.orderLineCost.update({ where: { id: cost.id }, data: { amount: cost.amount } });
          }
        }
      }

      // A reduced invoice can leave payments overallocated. Release the excess back to the
      // customer's unallocated credit; the payment itself and the balance ledger stay intact.
      const allocations = await tx.paymentAllocation.findMany({ where: { orderId: id }, orderBy: { createdAt: 'desc' } });
      const releasedAllocations = allocationReleasePlan(allocations, grandTotal);
      for (const allocation of releasedAllocations) {
        if (allocation.amount === 0) await tx.paymentAllocation.delete({ where: { id: allocation.id } });
        else await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { amount: allocation.amount } });
      }
      const addedAllocations = [];
      if (existing.customerId && existing.paymentMethod === 'credit' && grandTotal > existing.grandTotal) {
        let due = grandTotal - allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
        const payments = await tx.payment.findMany({
          where: { customerId: existing.customerId }, include: { allocations: true }, orderBy: { createdAt: 'asc' },
        });
        for (const payment of payments) {
          if (due <= 0) break;
          const free = payment.amount - payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
          if (free <= 0) continue;
          const amount = Math.min(due, free);
          const allocation = await tx.paymentAllocation.create({ data: { paymentId: payment.id, orderId: id, amount } });
          addedAllocations.push({ id: allocation.id, paymentId: payment.id, amount });
          due -= amount;
        }
      }

      const updated = await tx.order.update({ where: { id }, data: {
        subtotal, discount, transportFee, labourFee, otherFee, grandTotal,
        deliveryStatus: body.delivered ? 'delivered' : 'pending',
        saleDate, deliveryDate,
        deliveredAt: body.delivered ? new Date() : null,
        deliveredBy: body.delivered ? session.user.id : null,
      } });
      if (existing.customerId && existing.paymentMethod === 'credit' && grandTotal !== existing.grandTotal) {
        await tx.customer.update({ where: { id: existing.customerId }, data: { balance: { increment: grandTotal - existing.grandTotal } } });
      }
      if (creditOverrideUsed) await tx.flag.create({ data: {
        branchId: existing.branchId, targetType: 'Order', targetId: id, severity: 'concern', classification: 'concern',
        reason: `Pending sale ${existing.orderNumber} edit overrode the customer's credit limit: ${reason}`, raisedBy: session.user.id,
      } });
      await tx.auditLog.create({ data: {
        action: 'order.pending_delivery.edited', entityType: 'Order', entityId: id,
        actorUserId: session.user.id, actorName: session.user.name,
        before: { deliveryStatus: existing.deliveryStatus, saleDate: existing.saleDate, deliveryDate: existing.deliveryDate, subtotal: existing.subtotal, discount: existing.discount, transportFee: existing.transportFee, labourFee: existing.labourFee, otherFee: existing.otherFee, grandTotal: existing.grandTotal, allocations: allocations.map((allocation) => ({ id: allocation.id, paymentId: allocation.paymentId, amount: allocation.amount })), lines: existing.lines.map((line) => ({ id: line.id, qty: line.qty, stockQty: line.stockQty, unitPrice: line.unitPrice, transportFee: line.transportFee, costs: line.costs.map((cost) => ({ id: cost.id, amount: cost.amount })) })) },
        after: { deliveryStatus: updated.deliveryStatus, saleDate: updated.saleDate, deliveryDate: updated.deliveryDate, subtotal, discount, transportFee, labourFee, otherFee, grandTotal, reason, releasedAllocations, addedAllocations, lines: prepared.map((item) => ({ id: item.line.id, qty: item.qty, stockQty: item.stockQty, unitPrice: item.unitPrice, transportFee: item.transportFee, costs: item.costs.map((cost) => ({ id: cost.id, amount: cost.amount })) })) },
      } });
      return updated;
    }, { timeout: 30000, isolationLevel: 'Serializable' });

    if (discountOtpUsed) await notifyReviewers({
      actorUserId: session.user.id, type: 'sale_discount', title: 'Pending sale discount edited',
      message: `${session.user.name} changed the discount on sale ${existing.orderNumber}. Reason: ${reason}`,
      relatedType: 'Order', relatedId: id,
    });
    if (creditOverrideUsed) await notifyReviewers({
      actorUserId: session.user.id, type: 'credit_override', title: 'Pending sale credit override',
      message: `${session.user.name} overrode the credit limit when editing sale ${existing.orderNumber}. Reason: ${reason}`,
      relatedType: 'Order', relatedId: id,
    });
    return NextResponse.json({ success: true, data: { id: result.id, deliveryStatus: result.deliveryStatus, deliveryRevision: result.deliveryRevision } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || (error.code === 'P2034' ? 409 : 400) });
  }
}, 'shop');
