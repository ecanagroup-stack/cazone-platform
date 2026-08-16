import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's /api/shop-products/stock-in — a manual, no-supplier stock receipt for
// a plain shop item (the Cement Warehouse's Inventory tab's "Add Stock In"). Just a StockMove; cazone
// already computes on-hand live from the ledger (lib/stock.js) rather than a cached quantity field on
// the product itself, so unlike the old app's ShopProduct.stockQuantity there's nothing else to touch.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'stock.receive')) {
    return NextResponse.json({ error: 'You do not have permission to receive stock' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const branchId = body.branchId;
    const quantity = Number(body.quantity);
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ApiError('Quantity must be a positive number', 400);

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new ApiError('Product not found', 404);

    const move = await prisma.stockMove.create({
      data: { branchId, productId: id, qty: quantity, reason: 'purchase', note: (body.description || '').trim() || null, userId: session.user.id },
    });
    return NextResponse.json({ success: true, data: move }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
