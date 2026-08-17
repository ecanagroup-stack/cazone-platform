import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's /api/cement-brands — a cement brand IS a Product (serviceId-scoped,
// same PriceRule/PriceHistory pricing lib::this app already has), just filtered to the ones with an
// abbreviation set (the marker that distinguishes a cement brand from a plain shop item or a
// stonedust product, which uses supplierId instead — see prisma/schema.prisma's Product comment).
export const GET = withOrg(async (request) => {
  try {
    const serviceId = new URL(request.url).searchParams.get('serviceId');
    if (!serviceId) throw new ApiError('serviceId is required', 400);

    const brands = await prisma.product.findMany({
      where: { serviceId, isActive: true, abbreviation: { not: null } },
      include: { priceRules: { where: { validTo: null } } },
      orderBy: { name: 'asc' },
    });
    const data = brands.map((b) => ({ ...b, currentPrice: b.priceRules[0]?.price ?? null, priceRules: undefined }));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'materials.catalog.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage cement brands' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const serviceId = body.serviceId;
    const name = (body.name || '').trim();
    const abbreviation = (body.abbreviation || '').trim().toUpperCase().slice(0, 3);
    const bagSize = Number(body.bagSize) || 50;
    const price = Math.round(Number(body.currentPricePerBag));

    if (!serviceId || !name || !abbreviation) throw new ApiError('Brand name and abbreviation are required', 400);
    if (!Number.isFinite(price) || price <= 0) throw new ApiError('A starting price per bag is required', 400);

    const attributes = {};
    if (body.grade) attributes.grade = body.grade;
    if (body.depot) attributes.depotName = body.depot;

    const brand = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: { serviceId, name, unit: 'bag', abbreviation, attributes: { ...attributes, bagSize } },
      });
      await setPrice(tx, created.id, price, { id: session.user.id, role: session.user.role });
      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: brand }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
