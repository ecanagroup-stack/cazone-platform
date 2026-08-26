import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setCustomerPrice } from '@/lib/pricing';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

export const PUT = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to set pricing' }, { status: 403 });
  }
  try {
    const { id, productId } = await params;
    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!customer) throw new ApiError('Customer not found', 404);
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
    if (!product) throw new ApiError('Product not found', 404);

    const body = await request.json();
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price < 0) throw new ApiError('Invalid price', 400);

    await setCustomerPrice(productId, id, price, session.user.id);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'customer.price_set', entityType: 'Customer', entityId: id,
      after: { productId, productName: product.name, price },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const DELETE = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to set pricing' }, { status: 403 });
  }
  try {
    const { id, productId } = await params;
    await setCustomerPrice(productId, id, null, session.user.id);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'customer.price_cleared', entityType: 'Customer', entityId: id,
      after: { productId },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
