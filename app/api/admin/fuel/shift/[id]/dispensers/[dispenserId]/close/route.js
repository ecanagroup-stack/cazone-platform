import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// D5 of the fuel port: this used to close the loop by itself (create the Order immediately). Now
// it's just the supervisor's half — records closing/rtt, computes litres/expectedAmount at today's
// price and stores them, and leaves reviewStatus 'pending'. Nothing financial happens until a
// manager approves (see .../approve/route.js) — a cashier's payment entry happens independently in
// between (see .../payment/route.js). Re-submittable while reviewStatus is 'queried', not just once.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'fuel.readings.submit')) {
    return NextResponse.json({ error: 'You do not have permission to submit pump readings' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const closing = Number(body.closing);
    const rtt = Number(body.rtt) || 0;
    if (!Number.isFinite(closing)) throw new ApiError('Closing reading is required', 400);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('No opening reading found for this dispenser on this shift', 404);
    if (reading.closing != null && reading.reviewStatus !== 'queried') {
      throw new ApiError('This dispenser has already been submitted for this shift', 400);
    }
    if (closing < reading.opening) throw new ApiError('Closing reading cannot be less than the opening reading', 400);

    // Litres already sold to named credit customers this shift (see credit-fill route) are excluded
    // from this aggregate cash sale — they were already invoiced individually.
    const litres = closing - reading.opening - rtt - reading.creditLitres;
    if (litres < 0) throw new ApiError('Recorded credit fills exceed the total litres dispensed — check the credit fills for this pump', 400);

    const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
    if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);
    const productId = dispenser.tank.productId;

    const priceRule = await prisma.priceRule.findFirst({ where: { productId, validTo: null }, orderBy: { validFrom: 'desc' } });
    if (!priceRule) throw new ApiError('No price is set for this product — set one from Begin Shift', 400);

    const expectedAmount = Math.round(litres * priceRule.price);

    const updated = await prisma.meterReading.update({
      where: { id: reading.id },
      data: {
        closing, rtt, recordedBy: session.user.id, litres, expectedAmount,
        reviewStatus: 'pending', reviewedBy: null, reviewedAt: null, discrepancyNote: null,
      },
    });

    return NextResponse.json({ success: true, data: { litres, expectedAmount, reading: updated } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
