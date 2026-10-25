import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { setPrice } from '@/lib/pricing';
import { logAudit } from '@/lib/audit';
import { isAtcProduct } from '@/lib/petroleumAtc.mjs';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!['owner', 'manager'].includes(session?.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const access = await getAccessibleBranchIds(session);
  const service = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { id: true } });
  const [branches, products] = await Promise.all([
    prisma.branch.findMany({ where: { serviceId: service.id, isActive: true, ...(access ? { id: { in: access } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { serviceId: service.id, isActive: true, unit: 'litre' }, select: { id: true, name: true, attributes: true }, orderBy: { name: 'asc' } }),
  ]);
  // ATC products are priced on the distributor page, not per pump station.
  return NextResponse.json({ success: true, data: { branches, products: products.filter((p) => !isAtcProduct(p)).map(({ id, name }) => ({ id, name })) } });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') return NextResponse.json({ error: 'Only the Admin can update fuel prices immediately' }, { status: 403 });
  try {
    const body = await request.json();
    const branchId = String(body.branchId || '');
    const productId = String(body.productId || '');
    const reason = String(body.reason || '').trim();
    const naira = Number(body.price);
    const price = Math.round(naira * 100);
    if (!reason) throw new ApiError('Give a reason for the price change', 400);
    if (!Number.isFinite(naira) || naira <= 0 || !Number.isSafeInteger(price)) throw new ApiError('Enter a valid price per litre', 400);
    const [branch, product] = await Promise.all([
      prisma.branch.findFirst({ where: { id: branchId, service: { type: 'fuel_station' }, isActive: true }, select: { id: true } }),
      prisma.product.findFirst({ where: { id: productId, service: { type: 'fuel_station' }, unit: 'litre', isActive: true }, select: { id: true, attributes: true } }),
    ]);
    if (!branch || !product || isAtcProduct(product)) throw new ApiError('Choose an active fuel station and product', 400);
    await prisma.$transaction((tx) => setPrice(tx, product.id, price, { id: session.user.id, role: session.user.role }, reason, branch.id));
    await logAudit({ organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name, action: 'fuel.price.updated', entityType: 'Product', entityId: product.id, after: { branchId, price, reason } });
    return NextResponse.json({ success: true, data: { price } });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
});
