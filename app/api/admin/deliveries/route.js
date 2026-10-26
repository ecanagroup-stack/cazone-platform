import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getOnHandByProduct } from '@/lib/stock';
import { autoArriveDueAllocations } from '@/lib/allocation';
import { ApiError } from '@/lib/apiError';
import { isAtcProduct } from '@/lib/petroleumAtc.mjs';
import { logAudit } from '@/lib/audit';
import { notifyAlteration } from '@/lib/notify';
import { computeFuelOffload, offloadVariance } from '@/lib/fuelDelivery.mjs';
import { getAccessibleBranchIds, canAccessBranch, requireBranch } from '@/lib/branchAccess';
import { optionalBusinessDate, backdatedAt, parseBusinessDate } from '@/lib/saleDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { jsonSafe } from '@/lib/jsonSafe';

// The tankers a fuel branch can offload from: registered as a tanker, or already used for a fuel delivery
// (same rule as the Fuel > Trucks list).
const FUEL_VEHICLES = { isActive: true, OR: [{ type: 'tanker' }, { deliveries: { some: { branch: { service: { type: 'fuel_station' } } } } }] };

// A delivery with its figures spelled out the way the fuel screens quote them: `quantity` is the ACTUAL
// litres received, `declaredLoad` the waybill, and the variance is split into shortage / excess litres.
function withOffloadFigures(delivery) {
  const { variance, shortage, excess } = delivery.declaredLoad == null
    ? { variance: null, shortage: 0, excess: 0 }
    : offloadVariance(delivery.quantity, delivery.declaredLoad);
  return { ...delivery, actualLitres: delivery.quantity, offloadVariance: variance, shortage, excess };
}

// Returns the branch's delivery history plus everything the "Record Delivery" form needs
// (suppliers, this branch's service's products, current on-hand per product) in one call — same
// shape as the fuel shift/tanks GET routes.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);
    const session = await getOrgSession();
    await requireBranch(session, branchId);

    await autoArriveDueAllocations();

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { service: { select: { type: true } } } });
    if (!branch) throw new ApiError('Branch not found', 404);

    const isFuel = branch.service.type === 'fuel_station';
    const [deliveries, suppliers, products, tanks, vehicles, openShift] = await Promise.all([
      prisma.delivery.findMany({
        where: { branchId },
        include: { supplier: true, vehicle: true, product: true, tank: true, tanks: { include: { tank: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({ where: { serviceId: branch.serviceId, isActive: true }, orderBy: { name: 'asc' } }).then((all) => all.filter((p) => !isAtcProduct(p))),
      // Only populated for fuel branches — lets the delivery form offer "verify with tank dip" when
      // the chosen product actually has a receiving tank.
      prisma.tank.findMany({ where: { branchId, isActive: true }, orderBy: { label: 'asc' } }),
      // A fuel offload needs a registered tanker and an open shift to belong to.
      isFuel && can(session.user.role, 'stock.receive')
        ? prisma.vehicle.findMany({ where: FUEL_VEHICLES, select: { id: true, plateNumber: true, driverName: true, driverPhone: true, capacity: true }, orderBy: { plateNumber: 'asc' } })
        : [],
      isFuel ? prisma.shift.findFirst({ where: { branchId, status: 'open' }, orderBy: { openedAt: 'desc' }, select: { id: true, operatingDate: true, openedAt: true } }) : null,
    ]);

    const onHand = await getOnHandByProduct(branchId, products.map((p) => p.id));

    return NextResponse.json(jsonSafe({ success: true, data: { deliveries: deliveries.map(withOffloadFigures), suppliers, products, onHand, tanks, vehicles, openShift, serviceType: branch.service.type } }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

// Fuel tanker offload — petrol-station-app's Truck Offload (api/stations/[id]/stock) ported. Needs a
// shift open at the branch, a registered tanker (the driver is snapshotted per trip) and the declared
// waybill load. The actual litres come from per-tank dips or a typed figure; stock goes up by the
// ACTUAL litres, never the declared load. A short delivery is not tolerance-flagged (as in the old
// app): the branch manager and Admin are told instead.
async function recordFuelDelivery({ session, body, branch }) {
  const branchId = branch.id;
  const productId = body.productId;
  // A fuel offload happens now, into the open shift; a past one goes through Historical Entries.
  if (backdatedAt(optionalBusinessDate(body.deliveryDate, 'Delivery date'))) {
    throw new ApiError('Use Historical Entries to record a past fuel delivery', 400);
  }

  const [product, vehicle, tanks] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, serviceId: branch.serviceId, isActive: true } }),
    prisma.vehicle.findFirst({ where: { AND: [FUEL_VEHICLES, { id: String(body.vehicleId || '') }] } }),
    prisma.tank.findMany({ where: { branchId, isActive: true } }),
  ]);
  if (!product || isAtcProduct(product)) throw new ApiError('Choose a fuel product sold at this branch', 400);
  if (!vehicle) throw new ApiError('Choose a registered tanker. Register it under Fuel > Trucks first.', 400);

  const offload = computeFuelOffload({
    declaredLoad: body.declaredLoad, productId, branchTanks: tanks,
    tanks: body.tanks, actualLitres: body.actualLitres, tankId: body.tankId || undefined,
  });

  // Cost is optional: a total (as the old form took it) or a price per litre, both in kobo.
  const kobo = (value, label) => {
    if (value === '' || value == null) return null;
    const number = Math.round(Number(value));
    if (!Number.isSafeInteger(number) || number < 0) throw new ApiError(`Invalid ${label}`, 400);
    return number;
  };
  let totalCostNumber = kobo(body.totalCost, 'total cost');
  let costPerUnit = kobo(body.costPerUnit, 'cost per unit');
  if (totalCostNumber != null) costPerUnit = Math.round(totalCostNumber / offload.actual);
  else if (costPerUnit != null) totalCostNumber = Math.round(offload.actual * costPerUnit);
  if (totalCostNumber != null && !Number.isSafeInteger(totalCostNumber)) throw new ApiError('Total delivery cost is too large to record safely', 400);

  const driverName = String(body.driverName ?? vehicle.driverName ?? '').trim() || null;
  const driverPhone = String(body.driverPhone ?? vehicle.driverPhone ?? '').trim() || null;
  const notes = String(body.notes || '').trim() || null;
  const first = offload.tanks[0];

  const delivery = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findFirst({ where: { branchId, status: 'open' }, orderBy: { openedAt: 'desc' } });
    if (!shift) throw new ApiError('Open a shift before recording a fuel delivery. Deliveries are recorded against the running shift.', 409);

    let supplierId = body.supplierId || null;
    if (supplierId && !(await tx.supplier.findFirst({ where: { id: supplierId } }))) throw new ApiError('Supplier not found', 400);
    if (!supplierId && String(body.newSupplierName || '').trim()) {
      supplierId = (await tx.supplier.create({ data: { name: body.newSupplierName.trim() } })).id;
    }

    const created = await tx.delivery.create({
      data: {
        branchId, supplierId, vehicleId: vehicle.id, productId, quantity: offload.actual,
        costPerUnit, totalCost: totalCostNumber == null ? null : BigInt(totalCostNumber),
        status: 'received', receivedAt: new Date(), createdBy: session.user.id,
        businessDate: shift.operatingDate ? parseBusinessDate(shift.operatingDate, 'Shift date') : null,
        shiftId: shift.id, driverName, driverPhone, notes,
        declaredLoad: offload.declaredLoad, offloadVariance: offload.variance,
        // The first tank mirrors onto the delivery itself for readers that predate multi-tank offloads.
        tankId: first?.tankId ?? null, openingDip: first?.openingDip ?? null, closingDip: first?.closingDip ?? null,
      },
    });
    if (offload.tanks.length) {
      await tx.deliveryTank.createMany({
        data: offload.tanks.map((tank) => ({ deliveryId: created.id, tankId: tank.tankId, openingDip: tank.openingDip, closingDip: tank.closingDip, offloaded: tank.offloaded })),
      });
    }
    await tx.stockMove.create({
      data: { branchId, productId, qty: offload.actual, reason: 'purchase', ref: created.id, userId: session.user.id },
    });
    return tx.delivery.findUnique({
      where: { id: created.id },
      include: { supplier: true, vehicle: true, product: true, tank: true, tanks: { include: { tank: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
  }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

  await logAudit({
    organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
    action: 'fuel.delivery.recorded', entityType: 'Delivery', entityId: delivery.id,
    after: {
      branchId, shiftId: delivery.shiftId, product: product.name, truck: vehicle.plateNumber, driverName, driverPhone,
      declaredLoad: offload.declaredLoad, actual: offload.actual, offloadVariance: offload.variance,
      tanks: offload.tanks.map(({ tankLabel, ...tank }) => tank),
    },
  });

  if (offload.shortage > 0) {
    await notifyAlteration({
      actor: session.user, branchId, type: 'delivery_shortage', title: 'Fuel delivery came in short',
      message: `${session.user.name} recorded ${offload.actual.toLocaleString()} L of ${product.name} received from truck ${vehicle.plateNumber}, ${offload.shortage.toLocaleString()} L short of the ${offload.declaredLoad.toLocaleString()} L declared.`,
      relatedType: 'Delivery', relatedId: delivery.id,
    });
  }

  return { ...withOffloadFigures(delivery), flagged: offload.shortage > 0 };
}

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'stock.receive')) {
    return NextResponse.json({ error: 'You do not have permission to record a delivery' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const productId = body.productId;
    if (!branchId || !productId) throw new ApiError('Branch and product are required', 400);

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { service: { select: { type: true } } } });
    if (!branch || !canAccessBranch(await getAccessibleBranchIds(session), branchId)) throw new ApiError('Branch not found', 404);

    // 'allocation' = paid-for batch not yet on hand — see lib/allocation.js. A vehicle isn't required
    // yet in that mode (it's picked at the assign step, once one is actually sent to collect it).
    const asAllocation = body.mode === 'allocation';
    if (branch.service.type === 'fuel_station' && !asAllocation) {
      return NextResponse.json(jsonSafe({ success: true, data: await recordFuelDelivery({ session, body, branch }) }), { status: 201 });
    }

    const costPerUnit = body.costPerUnit === '' || body.costPerUnit == null
      ? null
      : Math.round(Number(body.costPerUnit));
    const vehiclePlate = (body.vehiclePlate || '').trim();
    const totalQuantity = Number(body.quantity);

    if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) throw new ApiError('Quantity must be positive', 400);
    if (costPerUnit != null && (!Number.isFinite(costPerUnit) || costPerUnit < 0)) throw new ApiError('Invalid cost per unit', 400);
    const totalCostNumber = costPerUnit == null ? null : Math.round(totalQuantity * costPerUnit);
    if (totalCostNumber != null && !Number.isSafeInteger(totalCostNumber)) throw new ApiError('Total delivery cost is too large to record safely', 400);
    if (!body.supplierId && !body.newSupplierName) throw new ApiError('Choose a supplier or name a new one', 400);

    // A delivery logged late carries the day it actually arrived.
    const deliveryDate = optionalBusinessDate(body.deliveryDate, 'Delivery date');
    const at = backdatedAt(deliveryDate);
    if (at && branch.service.type === 'fuel_station') throw new ApiError('Use Historical Entries to record a past fuel delivery', 400);
    assertBackdateOtpPresent(deliveryDate, body.backdateOtp);
    const backdated = await requireBackdateOtp({ userId: session.user.id, date: deliveryDate, otp: body.backdateOtp });

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

      const totalCost = totalCostNumber == null ? null : BigInt(totalCostNumber);
      const created = await tx.delivery.create({
        data: asAllocation
          ? { branchId, supplierId, vehicleId, productId, quantity: totalQuantity, costPerUnit, totalCost, status: 'pending', qtyRemaining: totalQuantity, createdBy: session.user.id, businessDate: deliveryDate }
          : { branchId, supplierId, vehicleId, productId, quantity: totalQuantity, costPerUnit, totalCost, status: 'received', receivedAt: at || new Date(), createdBy: session.user.id, businessDate: deliveryDate },
        include: { supplier: true, vehicle: true, product: true, tank: true },
      });

      // An allocation isn't on-hand stock yet — no purchase move until sales draw it down (or it's
      // separately received later). StockMove.ref already points back at this delivery for the
      // instant case — that's the traceable link in practice, so linkedStockMoveId is left unset.
      if (!asAllocation) {
        await tx.stockMove.create({
          data: { branchId, productId, qty: totalQuantity, reason: 'purchase', ref: created.id, userId: session.user.id, ...(at ? { at } : {}) },
        });
      }

      return created;
    }, { timeout: 15000 });

    if (backdated) await notifyBackdated({
      actor: session.user, branchId, date: deliveryDate, relatedType: 'Delivery', relatedId: delivery.id,
      what: `${asAllocation ? 'an allocation' : 'a delivery'} of ${totalQuantity} ${delivery.product.unit} of ${delivery.product.name}`,
    });

    return NextResponse.json(jsonSafe({ success: true, data: { ...delivery, flagged: false } }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
