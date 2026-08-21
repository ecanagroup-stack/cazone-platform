import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { getOnHandByProduct } from '@/lib/stock';

// Returns either the branch's open Shift (fully populated for the pump-grid view) or, if none is
// open, the setup data (active dispensers/attendants/current prices) the Begin Shift form needs.
export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);

    const openShift = await prisma.shift.findFirst({
      where: { branchId, status: 'open' },
      include: {
        // AttendantAssignment has no direct relation declared back to Shift's "active only" filter —
        // fetch all, the UI treats endedAt!=null rows as historical/superseded.
      },
    });

    if (openShift) {
      const [assignments, meterReadings, attendants, posTerminals, tanks, dispensers] = await Promise.all([
        prisma.attendantAssignment.findMany({
          where: { shiftId: openShift.id, endedAt: null },
          include: { attendant: true, dispenser: { include: { tank: { include: { product: true } } } } },
        }),
        prisma.meterReading.findMany({ where: { shiftId: openShift.id }, include: { posPayments: { include: { terminal: true } } } }),
        prisma.attendant.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.posTerminal.findMany({ where: { branchId, isActive: true }, orderBy: { label: 'asc' } }),
        // Closing tank stock (ecana's End Day "every tank needs a closing reading") — a tank counts as
        // done for this shift once it has a dip (lib/reconciliation.js) recorded after the shift opened.
        prisma.tank.findMany({ where: { branchId, isActive: true }, include: { product: true } }),
        // Every active dispenser at the branch, not just the ones already on this shift — lets the UI
        // offer "Add Pump" for one that was opened late (not part of the original Begin Shift batch).
        prisma.dispenser.findMany({ where: { branchId, isActive: true }, include: { tank: { include: { product: true } } } }),
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
      }));

      // Reconciliation is keyed by (branchId, productId) — same grain the stock ledger uses, not by
      // the physical tank (see the tank-dip route's own note on this).
      const dipsSinceOpen = await prisma.reconciliation.findMany({
        where: { branchId, productId: { in: tanks.map((t) => t.productId) }, periodEnd: { gte: openShift.openedAt } },
        select: { productId: true },
      });
      const dippedProductIds = new Set(dipsSinceOpen.map((d) => d.productId));
      const tanksWithDipStatus = tanks.map((t) => ({ ...t, dippedThisShift: dippedProductIds.has(t.productId) }));

      return NextResponse.json({ success: true, data: { shift: openShift, pumps, attendants, posTerminals, tanks: tanksWithDipStatus, dispensers } });
    }

    const [dispensers, attendants] = await Promise.all([
      prisma.dispenser.findMany({ where: { branchId, isActive: true }, include: { tank: { include: { product: true } } } }),
      prisma.attendant.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    const productIds = [...new Set(dispensers.map((d) => d.tank?.productId).filter(Boolean))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const priceRules = await prisma.priceRule.findMany({ where: { productId: { in: productIds }, validTo: null } });
    const priceByProduct = Object.fromEntries(priceRules.map((r) => [r.productId, r.price]));
    // Zero-stock warning (ecana's Begin Day) — lets Begin Shift flag a pump whose tank is already empty
    // rather than only discovering it once a sale fails.
    const onHandByProduct = await getOnHandByProduct(branchId, productIds);

    return NextResponse.json({
      success: true,
      data: { shift: null, dispensers, attendants, products, priceByProduct, onHandByProduct },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
