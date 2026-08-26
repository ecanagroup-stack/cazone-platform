import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// This customer's negotiated per-product prices, against the Construction Material ("shop") service's
// full product list — the only vertical with a self-service ordering flow (app/portal/shop) today.
// `customerPrice` is null wherever no PriceRule exists for this customer+product, meaning that
// product falls through to the list price at order time (see lib/pricing.js resolvePrice).
export const GET = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to view pricing' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const service = await prisma.service.findFirst({ where: { type: 'shop', isActive: true } });
    if (!service) return NextResponse.json({ success: true, data: { products: [] } });

    const products = await prisma.product.findMany({
      where: { serviceId: service.id, isActive: true },
      include: {
        priceRules: { where: { validTo: null, OR: [{ customerId: id }, { customerId: null }] } },
      },
      orderBy: { name: 'asc' },
    });

    const data = products.map((p) => {
      const listRule = p.priceRules.find((r) => r.customerId === null);
      const customerRule = p.priceRules.find((r) => r.customerId === id);
      return { id: p.id, name: p.name, unit: p.unit, listPrice: listRule?.price ?? null, customerPrice: customerRule?.price ?? null };
    });

    return NextResponse.json({ success: true, data: { products: data } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
