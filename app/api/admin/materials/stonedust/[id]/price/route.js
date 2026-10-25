import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'materials.catalog.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change prices' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const newPrice = Math.round(Number(body.newPrice));
    if (!Number.isFinite(newPrice) || newPrice <= 0) throw new ApiError('Invalid price', 400);

    const result = await prisma.$transaction((tx) =>
      setPrice(tx, id, newPrice, { id: session.user.id, role: session.user.role }, body.reason)
    );

    if (result.pending) {
      const product = await prisma.product.findUnique({ where: { id }, select: { name: true } });
      await notifyAlteration({ actor: session.user, type: 'price_proposed', title: 'Price change awaiting approval', message: `${session.user.name} proposed a new price for ${product?.name || 'a product'}`, relatedType: 'Product', relatedId: id });
    }

    return NextResponse.json({
      success: true, data: result.rule,
      ...(result.pending && { pricePending: true, message: 'Price change submitted for admin approval — the current price is unchanged until then' }),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
