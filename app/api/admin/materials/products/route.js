import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { getOnHandByProduct } from '@/lib/stock';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('serviceId');
    const branchId = url.searchParams.get('branchId'); // optional — on-hand is per-branch
    if (!serviceId) throw new ApiError('serviceId is required', 400);

    const products = await prisma.product.findMany({
      where: { serviceId },
      include: { priceRules: { where: { validTo: null } } },
      orderBy: { name: 'asc' },
    });
    const onHand = branchId ? await getOnHandByProduct(branchId, products.map((p) => p.id)) : {};
    const data = products.map((p) => ({
      ...p, currentPrice: p.priceRules[0]?.price ?? null, priceRules: undefined,
      onHand: branchId ? (onHand[p.id] || 0) : null,
    }));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage products' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const serviceId = body.serviceId;
    const name = (body.name || '').trim();
    const unit = (body.unit || '').trim();
    const category = body.category; // cement | stonedust | shop — informs which attributes fields the client showed
    const price = Math.round(Number(body.price));

    if (!serviceId || !name || !unit) throw new ApiError('Service, name and unit are required', 400);
    if (!Number.isFinite(price) || price < 0) throw new ApiError('Invalid price', 400);

    const attributes = {};
    if (category === 'cement') {
      if (body.grade) attributes.grade = body.grade;
      if (body.bagSize) attributes.bagSize = body.bagSize;
    } else if (category === 'stonedust') {
      if (body.quarry) attributes.quarry = body.quarry;
      if (body.size) attributes.size = body.size;
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { serviceId, name, unit, attributes } });
      if (price > 0) await setPrice(tx, created.id, price, session.user.id);
      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
