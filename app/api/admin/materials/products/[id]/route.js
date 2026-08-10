import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { ApiError } from '@/lib/apiError';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage products' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (body.attributes && typeof body.attributes === 'object') update.attributes = body.attributes;

    const updated = await prisma.$transaction(async (tx) => {
      const product = Object.keys(update).length ? await tx.product.update({ where: { id }, data: update }) : await tx.product.findUnique({ where: { id } });
      if (!product) throw new ApiError('Product not found', 404);
      if (body.price !== undefined) {
        const price = Math.round(Number(body.price));
        if (!Number.isFinite(price) || price < 0) throw new ApiError('Invalid price', 400);
        await setPrice(tx, id, price, session.user.id);
      }
      return product;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
