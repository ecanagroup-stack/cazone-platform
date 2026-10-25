import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { canAccessBranch, getAccessibleBranchIds } from '@/lib/branchAccess';
import { rejectPendingOrder } from '@/lib/sale';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'sales.record')) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  try {
    const { id } = await params;
    const order = await prisma.order.findUnique({ where: { id }, include: { branch: { include: { service: true } } } });
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!order || !['shop', 'general_store'].includes(org?.businessType) || order.branch.service.type !== org.businessType)
      throw new ApiError('Order not found', 404);
    if (!canAccessBranch(await getAccessibleBranchIds(session), order.branchId)) throw new ApiError('Branch access denied', 403);
    const result = await rejectPendingOrder(id);
    await notifyAlteration({ actor: session.user, branchId: order.branchId, type: 'order_rejected', title: 'Pending order rejected', message: `${session.user.name} rejected pending order ${order.orderNumber}.`, relatedType: 'Order', relatedId: order.id });
    return NextResponse.json({ success: true, data: result });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
});
