import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { createPendingOrder } from '@/lib/sale';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Self-service order placement — sits `pending` until staff confirms it (app/admin/materials'
// pending-orders queue), never trusting a portal session to directly move stock or a balance.
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const body = await request.json();
    const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    const businessType = organization?.businessType;
    if (!['shop', 'general_store'].includes(businessType)) throw new ApiError('Online ordering is unavailable for this business', 403);
    const branch = await prisma.branch.findFirst({ where: {
      id: body.branchId, isActive: true, service: { type: businessType, isActive: true },
      customerAccess: { some: { customerId: session.user.customerId } },
    } });
    if (!branch) throw new ApiError('Choose one of your active branches', 400);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = await prisma.product.count({ where: { id: { in: productIds }, serviceId: branch.serviceId, isActive: true } });
    if (productIds.length !== products) throw new ApiError('An item is no longer available from this business', 400);
    const result = await createPendingOrder({
      session,
      branchId: body.branchId,
      customerId: session.user.customerId,
      lines,
      channel: businessType === 'shop' ? 'shop' : 'retail',
    });
    try {
      const managers = await prisma.user.findMany({
        where: { role: { in: ['owner', 'manager', 'materials_manager'] }, isActive: true },
        select: { id: true, role: true, branchAccess: { select: { branchId: true } } },
      });
      await Promise.all(managers.filter((user) => user.role === 'owner' || user.branchAccess.length === 0 ||
        user.branchAccess.some((access) => access.branchId === branch.id)).map((user) => notify({
        recipientUserId: user.id, type: 'pending_order', title: 'New customer order request',
        message: `Order ${result.order.orderNumber} was requested at ${branch.name} and needs confirmation.`,
        relatedType: 'Order', relatedId: result.order.id,
      })));
    } catch (notificationError) {
      console.error('Could not notify managers about customer order', notificationError);
    }

    return NextResponse.json({ success: true, data: result.order }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
