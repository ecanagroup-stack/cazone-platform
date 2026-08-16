import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Browse data for the self-service shop — the org's Materials service (key 'shop'; the retail
// counter is one of its modules alongside cement/aggregate), its active branches, and its
// priced/active products. No credit-limit info here (that's app/api/portal/me) — the actual check
// happens server-side at order time (lib/sale.js createPendingOrder).
export const GET = withOrg(async () => {
  try {
    const service = await prisma.service.findFirst({ where: { type: 'shop', isActive: true } });
    if (!service) throw new ApiError('This organization has no Materials service enabled', 404);

    const [branches, products] = await Promise.all([
      prisma.branch.findMany({ where: { serviceId: service.id, isActive: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({ where: { serviceId: service.id, isActive: true }, include: { priceRules: { where: { validTo: null } } }, orderBy: { name: 'asc' } }),
    ]);

    const data = {
      branches,
      products: products
        .map((p) => ({ ...p, currentPrice: p.priceRules[0]?.price ?? null, priceRules: undefined }))
        .filter((p) => p.currentPrice != null),
    };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
