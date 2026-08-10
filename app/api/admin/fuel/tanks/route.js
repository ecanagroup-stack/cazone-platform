import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getOnHandByProduct } from '@/lib/stock';
import { ApiError } from '@/lib/apiError';

// Returns both the branch's tanks (with dispensers nested) and the branch's service's product
// catalog, so the client can populate the tank form's product picker in one request.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError('Branch not found', 404);

    const [tanks, products] = await Promise.all([
      prisma.tank.findMany({ where: { branchId }, include: { dispensers: true, product: true }, orderBy: { createdAt: 'asc' } }),
      prisma.product.findMany({ where: { serviceId: branch.serviceId, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    const onHand = await getOnHandByProduct(branchId, tanks.map((t) => t.productId));
    const tanksWithStock = tanks.map((t) => ({ ...t, onHand: onHand[t.productId] || 0 }));

    return NextResponse.json({ success: true, data: { tanks: tanksWithStock, products } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage tanks' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const label = (body.label || '').trim();
    const capacity = Number(body.capacity);
    const newProductName = (body.newProductName || '').trim();

    if (!branchId || !label) throw new ApiError('Branch and tank label are required', 400);
    if (!Number.isFinite(capacity) || capacity <= 0) throw new ApiError('Capacity must be a positive number', 400);
    if (!body.productId && !newProductName) throw new ApiError('Choose a product or name a new one', 400);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError('Branch not found', 404);

    let productId = body.productId;
    if (!productId) {
      const product = await prisma.product.create({
        data: { serviceId: branch.serviceId, name: newProductName, unit: 'litre' },
      });
      productId = product.id;
    }

    const tank = await prisma.tank.create({ data: { branchId, productId, label, capacity } });
    return NextResponse.json({ success: true, data: tank }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
