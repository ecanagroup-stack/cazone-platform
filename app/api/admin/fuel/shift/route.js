import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { getOnHandByProduct } from '@/lib/stock';
import { summarizePumpCollection, displayedFuelOperatingDate } from '@/lib/fuelCollections.mjs';

// Returns either the branch's open Shift (fully populated for the pump-grid view) or, if none is
// open, the setup data (active dispensers/attendants/current prices) the Begin Shift form needs.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);
    const access = await getAccessibleBranchIds(session);
    if (!canAccessBranch(access, branchId)) throw new ApiError('Access denied to this branch', 403);

    const openShift = await prisma.shift.findFirst({
      where: { branchId, status: 'open' },
      include: {
        // AttendantAssignment has no direct relation declared back to Shift's "active only" filter —
        // fetch all, the UI treats endedAt!=null rows as historical/superseded.
      },
    });

    if (openShift) {
      const [assignments, meterReadings, collections, attendants, posTerminals, tanks, dispensers, closingDips] = await Promise.all([
        prisma.attendantAssignment.findMany({
          where: { shiftId: openShift.id, endedAt: null },
          include: { attendant: true, dispenser: { include: { tank: { include: { product: true } } } } },
        }),
        prisma.meterReading.findMany({ where: { shiftId: openShift.id }, include: { posPayments: { include: { terminal: true } } } }),
        prisma.fuelCollection.findMany({ where: { shiftId: openShift.id }, orderBy: { createdAt: 'asc' } }),
        prisma.attendant.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.posTerminal.findMany({ where: { branchId, isActive: true }, orderBy: { label: 'asc' } }),
        // Closing tank stock (ecana's End Day "every tank needs a closing reading") — a tank counts as
        // done for this shift once it has a dip (lib/reconciliation.js) recorded after the shift opened.
        prisma.tank.findMany({ where: { branchId, isActive: true }, include: { product: true } }),
        // Every active dispenser at the branch, not just the ones already on this shift — lets the UI
        // offer "Add Pump" for one that was opened late (not part of the original Begin Shift batch).
        prisma.dispenser.findMany({ where: { branchId, isActive: true }, include: { tank: { include: { product: true } } } }),
        prisma.fuelTankDip.findMany({ where: { shiftId: openShift.id, period: 'closing' } }),
      ]);
      const readingByDispenser = Object.fromEntries(meterReadings.map((r) => [r.dispenserId, r]));
      const pumps = assignments.map((a) => ({
        dispenserId: a.dispenserId,
        dispenserLabel: a.dispenser.label,
        productId: a.dispenser.tank?.productId || null,
        productName: a.dispenser.tank?.product?.name || null,
        attendantId: a.attendantId,
        attendantName: a.attendant.name,
        reading: readingByDispenser[a.dispenserId] || null,
        collections: collections.filter((c) => c.dispenserId === a.dispenserId),
        collectionSummary: summarizePumpCollection(readingByDispenser[a.dispenserId]?.expectedAmount,
          collections.filter((c) => c.dispenserId === a.dispenserId)),
      }));

      const dippedTankIds = new Set(closingDips.map((dip) => dip.tankId));
      const tanksWithDipStatus = tanks.map((t) => ({ ...t, dippedThisShift: dippedTankIds.has(t.id) }));

      const products = [...new Map(tanks.map((tank) => [tank.product.id, tank.product])).values()];
      return NextResponse.json({ success: true, data: { shift: openShift, pumps, attendants, posTerminals, tanks: tanksWithDipStatus, dispensers, products } });
    }

    const [dispensers, attendants, tanks] = await Promise.all([
      prisma.dispenser.findMany({ where: { branchId, isActive: true }, include: { tank: { include: { product: true } } } }),
      prisma.attendant.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
      prisma.tank.findMany({ where: { branchId, isActive: true }, include: { product: true }, orderBy: { label: 'asc' } }),
    ]);

    const productIds = [...new Set(dispensers.map((d) => d.tank?.productId).filter(Boolean))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const priceRules = await prisma.priceRule.findMany({ where: { productId: { in: productIds }, branchId, validTo: null }, orderBy: { validFrom: 'asc' } });
    const legacyRules = await prisma.priceRule.findMany({ where: { productId: { in: productIds }, branchId: null, validTo: null }, orderBy: { validFrom: 'asc' } });
    const priceByProduct = Object.fromEntries([...legacyRules, ...priceRules].map((r) => [r.productId, r.price]));
    // Zero-stock warning (ecana's Begin Day) — lets Begin Shift flag a pump whose tank is already empty
    // rather than only discovering it once a sale fails.
    const onHandByProduct = await getOnHandByProduct(branchId, productIds);

    const recent = await prisma.shift.findFirst({ where: { branchId }, orderBy: { openedAt: 'desc' },
      select: { operatingDate: true, openedAt: true, closedAt: true, status: true } });
    const displayDate = displayedFuelOperatingDate(recent ? [recent] : []);
    const dayShifts = await prisma.shift.findMany({ where: { branchId, operatingDate: displayDate }, select: { id: true } });
    const recentSales = dayShifts.length ? await prisma.meterReading.findMany({
      where: { shiftId: { in: dayShifts.map((shift) => shift.id) }, closing: { not: null },
        ...(session.user.role === 'supervisor' ? { recordedBy: session.user.id } : {}) },
      include: { dispenser: { include: { tank: { include: { product: true } } } } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    return NextResponse.json({
      success: true,
      data: { shift: null, dispensers, attendants, tanks, products, priceByProduct, onHandByProduct, displayDate, recentSales },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
