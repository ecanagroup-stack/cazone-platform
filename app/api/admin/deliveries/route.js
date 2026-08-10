import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getOnHandByProduct } from '@/lib/stock';
import { ApiError } from '@/lib/apiError';

// Returns the branch's delivery history plus everything the "Record Delivery" form needs
// (suppliers, this branch's service's products, current on-hand per product) in one call — same
// shape as the fuel shift/tanks GET routes.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError('Branch not found', 404);

    const [deliveries, suppliers, products] = await Promise.all([
      prisma.delivery.findMany({
        where: { branchId },
        include: { supplier: true, vehicle: true, product: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({ where: { serviceId: branch.serviceId, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    const onHand = await getOnHandByProduct(branchId, products.map((p) => p.id));

    return NextResponse.json({ success: true, data: { deliveries, suppliers, products, onHand } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'stock.receive')) {
    return NextResponse.json({ error: 'You do not have permission to record a delivery' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const productId = body.productId;
    const quantity = Number(body.quantity);
    const costPerUnit = Math.round(Number(body.costPerUnit));
    const vehiclePlate = (body.vehiclePlate || '').trim();

    if (!branchId || !productId) throw new ApiError('Branch and product are required', 400);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ApiError('Quantity must be positive', 400);
    if (!Number.isFinite(costPerUnit) || costPerUnit < 0) throw new ApiError('Invalid cost per unit', 400);
    if (!body.supplierId && !body.newSupplierName) throw new ApiError('Choose a supplier or name a new one', 400);

    const delivery = await prisma.$transaction(async (tx) => {
      let supplierId = body.supplierId;
      if (!supplierId) {
        const supplier = await tx.supplier.create({ data: { name: body.newSupplierName.trim() } });
        supplierId = supplier.id;
      }

      let vehicleId = null;
      if (vehiclePlate) {
        const existing = await tx.vehicle.findFirst({ where: { plateNumber: vehiclePlate } });
        vehicleId = existing ? existing.id : (await tx.vehicle.create({ data: { plateNumber: vehiclePlate } })).id;
      }

      const totalCost = Math.round(quantity * costPerUnit);
      const created = await tx.delivery.create({
        data: {
          branchId, supplierId, vehicleId, productId, quantity, costPerUnit, totalCost,
          status: 'received', receivedAt: new Date(), createdBy: session.user.id,
        },
        include: { supplier: true, vehicle: true, product: true },
      });

      // StockMove.ref already points back at this delivery — that's the traceable link in
      // practice, so linkedStockMoveId is left unset rather than spending a second write on it.
      await tx.stockMove.create({
        data: { branchId, productId, qty: quantity, reason: 'purchase', ref: created.id, userId: session.user.id },
      });

      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: delivery }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
