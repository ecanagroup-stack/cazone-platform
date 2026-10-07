import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { canAccessBranch, getAccessibleBranchIds } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!['owner', 'manager', 'materials_manager'].includes(session?.user?.role))
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) throw new ApiError('Give a reason for the price change', 400);
    const order = await prisma.order.findUnique({ where: { id }, include: { lines: true, branch: { include: { service: true } } } });
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!order || order.status !== 'pending' || !['shop', 'general_store'].includes(org?.businessType) || order.branch.service.type !== org.businessType)
      throw new ApiError('Pending order not found', 404);
    if (!canAccessBranch(await getAccessibleBranchIds(session), order.branchId)) throw new ApiError('Branch access denied', 403);
    if (!Number.isInteger(body.revision) || body.revision !== order.deliveryRevision) throw new ApiError('This order changed; reload it', 409);
    const edits = Array.isArray(body.lines) ? body.lines : [];
    if (edits.length !== order.lines.length || new Set(edits.map((line) => line.id)).size !== order.lines.length)
      throw new ApiError('Provide a price for every item', 400);
    const prices = order.lines.map((line) => {
      const edit = edits.find((item) => item.id === line.id);
      const price = Number(edit?.unitPrice);
      const cents = Math.round(price * 100);
      if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(cents) || !edit)
        throw new ApiError('Enter a valid price for every item', 400);
      return { line, cents, lineTotal: Math.round(line.qty * cents) };
    });
    if (prices.every(({ line, cents }) => line.unitPrice === cents)) throw new ApiError('No prices changed', 400);
    const subtotal = prices.reduce((total, item) => total + item.lineTotal, 0);
    if (!Number.isSafeInteger(subtotal)) throw new ApiError('Order total is too large', 400);
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({ where: { id, status: 'pending', deliveryRevision: order.deliveryRevision },
        data: { deliveryRevision: { increment: 1 } } });
      if (claim.count !== 1) throw new ApiError('This order changed; reload it', 409);
      for (const { line, cents, lineTotal } of prices) await tx.orderLine.update({ where: { id: line.id },
        data: { unitPrice: cents, managerUnitPrice: cents === line.unitPrice ? line.managerUnitPrice : cents,
          priceRuleId: cents === line.unitPrice ? line.priceRuleId : null, lineTotal } });
      const updated = await tx.order.update({ where: { id }, data: { subtotal, grandTotal: subtotal + order.transportFee } });
      await tx.auditLog.create({ data: { actorUserId: session.user.id, actorName: session.user.name,
        action: 'pendingOrder.priceEdited', entityType: 'Order', entityId: id,
        before: { subtotal: order.subtotal, grandTotal: order.grandTotal, prices: order.lines.map((line) => ({ id: line.id, unitPrice: line.unitPrice })) },
        after: { subtotal, grandTotal: subtotal + order.transportFee, reason,
          prices: prices.map(({ line, cents }) => ({ id: line.id, unitPrice: cents })) } } });
      return updated;
    }, { timeout: 15000, isolationLevel: 'Serializable' });
    return NextResponse.json({ success: true, data: result });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || (error.code === 'P2034' ? 409 : 400) }); }
});
