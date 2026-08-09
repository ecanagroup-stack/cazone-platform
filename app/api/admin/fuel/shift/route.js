import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

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
      const [assignments, meterReadings] = await Promise.all([
        prisma.attendantAssignment.findMany({
          where: { shiftId: openShift.id, endedAt: null },
          include: { attendant: true, dispenser: { include: { tank: { include: { product: true } } } } },
        }),
        prisma.meterReading.findMany({ where: { shiftId: openShift.id } }),
      ]);
      const readingByDispenser = Object.fromEntries(meterReadings.map((r) => [r.dispenserId, r]));
      const pumps = assignments.map((a) => ({
        dispenserId: a.dispenserId,
        dispenserLabel: a.dispenser.label,
        productName: a.dispenser.tank?.product?.name || null,
        attendantName: a.attendant.name,
        reading: readingByDispenser[a.dispenserId] || null,
      }));
      return NextResponse.json({ success: true, data: { shift: openShift, pumps } });
    }

    const [dispensers, attendants] = await Promise.all([
      prisma.dispenser.findMany({ where: { branchId, isActive: true }, include: { tank: { include: { product: true } } } }),
      prisma.attendant.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    const productIds = [...new Set(dispensers.map((d) => d.tank?.productId).filter(Boolean))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const priceRules = await prisma.priceRule.findMany({ where: { productId: { in: productIds }, validTo: null } });
    const priceByProduct = Object.fromEntries(priceRules.map((r) => [r.productId, r.price]));

    return NextResponse.json({
      success: true,
      data: { shift: null, dispensers, attendants, products, priceByProduct },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
