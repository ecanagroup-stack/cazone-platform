import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getOnHandByProduct } from '@/lib/stock';
import { autoArriveDueAllocations } from '@/lib/allocation';
import { evaluateVariance } from '@/lib/reconciliation';
import { ApiError } from '@/lib/apiError';

// Fuel tanker offloads run well under 1% variance (core-algorithms skill §5) — same default the
// manual tank dip uses, overridable per branch via Fuel Setup > Station Config (F1).
const DEFAULT_OFFLOAD_TOLERANCE_PCT = 0.5;

// Returns the branch's delivery history plus everything the "Record Delivery" form needs
// (suppliers, this branch's service's products, current on-hand per product) in one call — same
// shape as the fuel shift/tanks GET routes.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);

    await autoArriveDueAllocations();

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError('Branch not found', 404);

    const [deliveries, suppliers, products, tanks] = await Promise.all([
      prisma.delivery.findMany({
        where: { branchId },
        include: { supplier: true, vehicle: true, product: true, tank: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({ where: { serviceId: branch.serviceId, isActive: true }, orderBy: { name: 'asc' } }),
      // Only populated for fuel branches — lets the delivery form offer "verify with tank dip" when
      // the chosen product actually has a receiving tank.
      prisma.tank.findMany({ where: { branchId, isActive: true }, orderBy: { label: 'asc' } }),
    ]);

    const onHand = await getOnHandByProduct(branchId, products.map((p) => p.id));

    return NextResponse.json({ success: true, data: { deliveries, suppliers, products, onHand, tanks } });
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
    const costPerUnit = Math.round(Number(body.costPerUnit));
    const vehiclePlate = (body.vehiclePlate || '').trim();
    // 'allocation' = paid-for batch not yet on hand — see lib/allocation.js. A vehicle isn't required
    // yet in that mode (it's picked at the assign step, once one is actually sent to collect it).
    const asAllocation = body.mode === 'allocation';

    // Tanker offload verified against a physical dip (fuel only) — petrol-station-app's proven flow:
    // declared load vs. actual offloaded (closingDip - openingDip), captured in the same step as the
    // delivery itself, not a separate screen. Only valid alongside 'received' mode.
    const useDip = !asAllocation && body.tankId && body.openingDip !== '' && body.openingDip != null && body.closingDip !== '' && body.closingDip != null;
    let quantity, declaredLoad = null, openingDip = null, closingDip = null, offloadVariance = null;
    if (useDip) {
      openingDip = Number(body.openingDip);
      closingDip = Number(body.closingDip);
      declaredLoad = Number(body.quantity);
      if (!Number.isFinite(openingDip) || !Number.isFinite(closingDip)) throw new ApiError('Dip readings must be numbers', 400);
      if (closingDip < openingDip) throw new ApiError('Closing dip cannot be less than opening dip', 400);
      quantity = closingDip - openingDip;
      if (quantity <= 0) throw new ApiError('The dip readings show nothing was actually offloaded', 400);
      if (!Number.isFinite(declaredLoad) || declaredLoad <= 0) throw new ApiError('Declared load must be positive', 400);
      offloadVariance = quantity - declaredLoad;
    } else {
      quantity = Number(body.quantity);
    }
    const totalQuantity = quantity;

    if (!branchId || !productId) throw new ApiError('Branch and product are required', 400);
    if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) throw new ApiError('Quantity must be positive', 400);
    if (!Number.isFinite(costPerUnit) || costPerUnit < 0) throw new ApiError('Invalid cost per unit', 400);
    if (!body.supplierId && !body.newSupplierName) throw new ApiError('Choose a supplier or name a new one', 400);

    const { delivery, flagged } = await prisma.$transaction(async (tx) => {
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

      const totalCost = Math.round(totalQuantity * costPerUnit);
      const dipFields = useDip ? { tankId: body.tankId, declaredLoad, openingDip, closingDip, offloadVariance } : {};
      const created = await tx.delivery.create({
        data: asAllocation
          ? { branchId, supplierId, vehicleId, productId, quantity: totalQuantity, costPerUnit, totalCost, status: 'pending', qtyRemaining: totalQuantity, createdBy: session.user.id, ...dipFields }
          : { branchId, supplierId, vehicleId, productId, quantity: totalQuantity, costPerUnit, totalCost, status: 'received', receivedAt: new Date(), createdBy: session.user.id, ...dipFields },
        include: { supplier: true, vehicle: true, product: true, tank: true },
      });

      // An allocation isn't on-hand stock yet — no purchase move until sales draw it down (or it's
      // separately received later). StockMove.ref already points back at this delivery for the
      // instant case — that's the traceable link in practice, so linkedStockMoveId is left unset.
      if (!asAllocation) {
        await tx.stockMove.create({
          data: { branchId, productId, qty: totalQuantity, reason: 'purchase', ref: created.id, userId: session.user.id },
        });
      }

      let flagged = false;
      if (useDip) {
        const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { config: true } });
        const tolerancePct = Number(branch?.config?.reconciliationTolerancePct) || DEFAULT_OFFLOAD_TOLERANCE_PCT;
        const { status } = evaluateVariance(declaredLoad, quantity, declaredLoad, tolerancePct);
        if (status === 'exception') {
          flagged = true;
          await tx.flag.create({
            data: {
              branchId, targetType: 'Delivery', targetId: created.id,
              severity: 'concern', classification: 'concern',
              reason: `Tanker offload variance of ${offloadVariance.toFixed(1)}L on ${created.tank?.label || 'tank'} — declared ${declaredLoad.toLocaleString()}L, dip shows ${quantity.toLocaleString()}L`,
              raisedBy: session.user.id,
            },
          });
        }
      }

      return { delivery: created, flagged };
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: { ...delivery, flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
