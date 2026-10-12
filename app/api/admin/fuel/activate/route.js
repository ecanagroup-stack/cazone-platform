import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

async function loadOpeningStockSetup(organizationId) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const service = await prisma.service.findFirst({
    where: { organizationId, type: 'fuel_station' },
    select: {
      id: true, isActive: true, config: true,
      branches: {
        where: { isActive: true }, orderBy: { name: 'asc' },
        select: {
          id: true, name: true,
          tanks: {
            where: { isActive: true }, orderBy: { label: 'asc' },
            select: { id: true, label: true, capacity: true, productId: true, product: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!organization || !service) throw new ApiError('Fuel service was not found for this account', 404);
  return { organization, service };
}

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  try {
    const { organization, service } = await loadOpeningStockSetup(session.user.organizationId);
    return NextResponse.json({
      success: true,
      organizationName: organization.name,
      serviceId: service.id,
      isActive: service.isActive,
      pending: service.config?.migrationStockPending === true,
      branches: service.branches,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}, 'fuel_station');

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can start station operations' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const organizationId = session.user.organizationId;
    const { organization, service } = await loadOpeningStockSetup(organizationId);
    if (organization.name !== body.confirmation) throw new ApiError('Type the exact business name to confirm', 400);
    if (service.isActive || service.config?.migrationStockPending !== true) {
      throw new ApiError('Station operations are already active or no longer waiting for opening stock', 409);
    }

    const activeTanks = service.branches.flatMap((branch) => branch.tanks.map((tank) => ({ ...tank, branchId: branch.id, branchName: branch.name })));
    if (activeTanks.length === 0) throw new ApiError('Add at least one active tank before starting station operations', 400);
    const readings = Array.isArray(body.tankReadings) ? body.tankReadings : [];
    const readingsByTank = new Map(readings.map((reading) => [reading.tankId, reading]));
    if (readings.length !== activeTanks.length || readingsByTank.size !== activeTanks.length) {
      throw new ApiError('Enter one opening stock reading for every active tank', 400);
    }

    const normalizedReadings = activeTanks.map((tank) => {
      const input = readingsByTank.get(tank.id);
      const litres = input?.litres == null || String(input.litres).trim() === '' ? NaN : Number(input.litres);
      if (!input || !Number.isFinite(litres) || litres < 0 || litres > tank.capacity) {
        throw new ApiError(`Enter a reading from 0 to ${tank.capacity.toLocaleString()} L for ${tank.branchName} · ${tank.label}`, 400);
      }
      return { ...tank, litres };
    });
    const reason = (body.reason || '').trim();
    if (reason.length < 8) throw new ApiError('Add a short reference to the signed physical dip or opening-stock record', 400);
    if (reason.length > 500) throw new ApiError('Keep the evidence reference under 500 characters', 400);

    await verifyOtp({ userId: session.user.id, purpose: 'fuel_startup_stock', code: body.otp });
    const activatedAt = new Date();
    const nextConfig = { ...(service.config || {}), migrationStockPending: false };

    await prisma.$transaction(async (tx) => {
      const current = await tx.service.findUnique({ where: { id: service.id }, select: { isActive: true, config: true } });
      if (!current || current.isActive || current.config?.migrationStockPending !== true) {
        throw new ApiError('Station operations were already activated. Refresh the page.', 409);
      }

      const adjustmentsByStock = new Map();
      for (const tank of normalizedReadings) {
        const key = `${tank.branchId}:${tank.productId}`;
        const group = adjustmentsByStock.get(key) || { branchId: tank.branchId, productId: tank.productId, measured: 0, tanks: [] };
        group.measured += tank.litres;
        group.tanks.push(tank.label);
        adjustmentsByStock.set(key, group);
      }
      const stockAdjustments = [];
      for (const group of adjustmentsByStock.values()) {
        const book = await tx.stockMove.aggregate({
          where: { branchId: group.branchId, productId: group.productId },
          _sum: { qty: true },
        });
        const bookLitres = book._sum.qty || 0;
        const adjustment = Math.round((group.measured - bookLitres) * 1000) / 1000;
        if (adjustment !== 0) stockAdjustments.push({ ...group, bookLitres, adjustment });
      }

      const activation = await tx.service.updateMany({
        where: { id: service.id, organizationId, isActive: false },
        data: { isActive: true, config: nextConfig },
      });
      if (activation.count !== 1) throw new ApiError('Station operations changed while this form was open. Refresh the page.', 409);

      if (stockAdjustments.length > 0) await tx.stockMove.createMany({
        data: stockAdjustments.map((stock) => ({
          organizationId, branchId: stock.branchId, productId: stock.productId,
          qty: stock.adjustment, reason: 'stocktake',
          ref: `startup-opening-${activatedAt.toISOString()}`,
          offlineId: `fuel-startup-${activatedAt.getTime()}-${stock.branchId}-${stock.productId}`,
          userId: session.user.id, at: activatedAt,
          note: `Owner-signed opening stock reconciliation for ${stock.tanks.join(', ')}. Physical: ${stock.measured} L; ledger before reading: ${stock.bookLitres} L; adjustment: ${stock.adjustment} L. Evidence: ${reason}`,
        })),
      });

      await tx.auditLog.create({
        data: {
          organizationId, actorUserId: session.user.id, actorName: session.user.name,
          action: 'fuelOperations.activated', entityType: 'FuelService', entityId: service.id,
          before: { isActive: current.isActive, migrationStockPending: true },
          after: {
            isActive: true, migrationStockPending: false, reason,
            activatedAt: activatedAt.toISOString(),
            stockAdjustments: stockAdjustments.map((stock) => ({
              branchId: stock.branchId, productId: stock.productId, measured: stock.measured,
              bookBefore: stock.bookLitres, adjustment: stock.adjustment,
            })),
            tankReadings: normalizedReadings.map((tank) => ({
              branchId: tank.branchId, branchName: tank.branchName, tankId: tank.id,
              tank: tank.label, product: tank.product.name, capacity: tank.capacity, litres: tank.litres,
            })),
          },
        },
      });
    }, { timeout: 30000 });

    return NextResponse.json({
      success: true, activatedAt: activatedAt.toISOString(),
      serviceId: service.id, branchId: service.branches[0]?.id || null,
      tankCount: normalizedReadings.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}, 'fuel_station');
