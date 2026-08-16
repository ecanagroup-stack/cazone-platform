import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's /api/stonedust — a stonedust/aggregate product is a Product with
// `supplierId` set (the quarry it's bought from), the marker that distinguishes it from a cement
// brand (abbreviation set instead) or a plain shop item (neither set).
export const GET = withOrg(async (request) => {
  try {
    const serviceId = new URL(request.url).searchParams.get('serviceId');
    if (!serviceId) throw new ApiError('serviceId is required', 400);

    const products = await prisma.product.findMany({
      where: { serviceId, isActive: true, supplierId: { not: null } },
      include: { priceRules: { where: { validTo: null } }, supplier: true },
      orderBy: { name: 'asc' },
    });
    const data = products.map((p) => ({
      ...p, currentPrice: p.priceRules[0]?.price ?? null, priceRules: undefined,
      quarryName: p.supplier?.name, quarry: p.supplierId, supplier: undefined,
      size: p.attributes?.size,
    }));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage aggregate products' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const serviceId = body.serviceId;
    const supplierId = body.quarry;
    const size = (body.size || '').trim();
    const price = Math.round(Number(body.currentPricePerTonne));

    if (!serviceId || !supplierId || !size) throw new ApiError('Quarry and size are required', 400);
    if (!Number.isFinite(price) || price <= 0) throw new ApiError('A starting price per tonne is required', 400);

    const quarry = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!quarry) throw new ApiError('Quarry not found', 404);

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: { serviceId, name: `${quarry.name} — ${size}`, unit: 'tonne', supplierId, attributes: { size } },
      });
      await setPrice(tx, created.id, price, { id: session.user.id, role: session.user.role });
      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
