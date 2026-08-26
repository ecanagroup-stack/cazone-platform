import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Browse data for the self-service shop — the org's Materials service (key 'shop'; the retail
// counter is one of its modules alongside cement/aggregate), its active branches, and its
// priced/active products. `currentPrice` prefers this customer's own negotiated rate (set by
// owner/manager on their account) over the list price, so the cart total the customer sees here is
// exactly what confirming the order will charge — no surprise later (see lib/pricing.js
// resolvePrice). No credit-limit info here (that's app/api/portal/me) — the actual check happens
// server-side at order time (lib/sale.js createPendingOrder).
export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const service = await prisma.service.findFirst({ where: { type: 'shop', isActive: true } });
    if (!service) throw new ApiError('This organization has no Construction Material service enabled', 404);

    const [branches, products, customer, org] = await Promise.all([
      prisma.branch.findMany({ where: { serviceId: service.id, isActive: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({
        where: { serviceId: service.id, isActive: true },
        include: { priceRules: { where: { validTo: null, OR: [{ customerId: session.user.customerId }, { customerId: null }] } } },
        orderBy: { name: 'asc' },
      }),
      prisma.customer.findUnique({ where: { id: session.user.customerId }, select: { transportRate: true } }),
      prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { paymentsEnabled: true } }),
    ]);

    const data = {
      branches,
      transportRate: customer?.transportRate ?? null,
      paymentsEnabled: org?.paymentsEnabled || false,
      products: products
        .map((p) => {
          const customerRule = p.priceRules.find((r) => r.customerId === session.user.customerId);
          const listRule = p.priceRules.find((r) => r.customerId === null);
          return { ...p, currentPrice: customerRule?.price ?? listRule?.price ?? null, priceRules: undefined };
        })
        .filter((p) => p.currentPrice != null),
    };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
