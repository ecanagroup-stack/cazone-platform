import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { autoArriveDueAllocations } from '@/lib/allocation';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's /api/atcs — an ATC is a Delivery allocation (qtyRemaining set) whose
// product is a cement brand (abbreviation set, see prisma/schema.prisma's Product comment). The
// pending->assigned->loaded->arrived->closed lifecycle itself is the existing generic
// lib/allocation.js + .../assign, .../loading, .../arrive routes — this only adds cement-specific
// framing (brand filter, ATC numbering) on top.
export const GET = withOrg(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const status = searchParams.get('status');
    const brand = searchParams.get('brand');
    if (!serviceId) throw new ApiError('serviceId is required', 400);

    await autoArriveDueAllocations();

    const atcs = await prisma.delivery.findMany({
      where: {
        qtyRemaining: { not: null },
        product: { serviceId, abbreviation: { not: null } },
        ...(status ? { status } : {}),
        ...(brand ? { productId: brand } : {}),
      },
      include: { product: true, vehicle: true, orderLines: { include: { order: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const data = atcs.map((a) => ({
      ...a,
      supplies: a.orderLines.map((l) => ({ qtySupplied: l.qty, reference: l.order.orderNumber, saleDate: l.order.createdAt })),
      orderLines: undefined,
    }));

    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'allocations.manage')) {
    return NextResponse.json({ error: 'You do not have permission to record an ATC' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const productId = body.cementBrand;
    const atcNumber = (body.atcNumber || '').trim();
    const bagsPaidFor = Number(body.bagsPaidFor);

    if (!branchId || !productId || !atcNumber) throw new ApiError('Branch, brand and ATC number are required', 400);
    if (!Number.isFinite(bagsPaidFor) || bagsPaidFor <= 0) throw new ApiError('Bags must be a positive number', 400);

    const brand = await prisma.product.findUnique({ where: { id: productId } });
    if (!brand) throw new ApiError('Brand not found', 404);
    if (!brand.abbreviation) throw new ApiError('This brand has no abbreviation set', 400);

    const existing = await prisma.delivery.findFirst({ where: { atcNumber, productId } });
    if (existing) throw new ApiError('That ATC number is already used for this brand', 400);

    const atc = await prisma.delivery.create({
      data: {
        branchId, productId, atcNumber, notes: (body.notes || '').trim() || null,
        quantity: bagsPaidFor, qtyRemaining: bagsPaidFor, costPerUnit: 0, totalCost: 0,
        status: 'pending', createdBy: session.user.id,
      },
      include: { product: true, vehicle: true },
    });

    return NextResponse.json({ success: true, data: atc }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
