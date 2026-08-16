import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { createSaleOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Records a fill sold to a named credit customer mid-shift, before the pump closes — the piece that
// makes a fuel credit/fleet client's statement have anything on it (Shift/MeterReading alone are
// shift-aggregate only). Reuses lib/sale.js's pricing/credit/stock path rather than a parallel fuel
// sales model — Tank.product is a real Product, same as anything the materials counter sells.
// Bumps MeterReading.creditLitres in the same transaction so the eventual close-time aggregate cash
// sale is (closing - opening - rtt - creditLitres), never double-counting this fill.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const customerId = body.customerId;
    const litres = Number(body.litres);
    const overrideCredit = !!body.overrideCredit;
    if (!customerId) throw new ApiError('A customer is required for a credit fill', 400);
    if (!Number.isFinite(litres) || litres <= 0) throw new ApiError('Litres must be a positive number', 400);
    if (overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('No opening reading found for this dispenser on this shift', 404);
    if (reading.closing != null) throw new ApiError('This dispenser has already been closed for this shift', 400);

    const dispenser = await prisma.dispenser.findUnique({ where: { id: dispenserId }, include: { tank: true } });
    if (!dispenser?.tank) throw new ApiError('This dispenser has no tank/product configured', 400);

    const result = await createSaleOrder({
      session,
      branchId: shift.branchId,
      customerId,
      paymentMethod: 'credit',
      lines: [{ productId: dispenser.tank.productId, qty: litres }],
      overrideCredit,
      onOrderCreated: (tx) => tx.meterReading.update({ where: { id: reading.id }, data: { creditLitres: { increment: litres } } }),
    });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }

    if (result.flagged) {
      await notify({ recipientRole: 'owner', type: 'flag_raised', title: 'Credit limit overridden', message: `Credit fill ${result.order.orderNumber} overrode a customer's credit limit`, relatedType: 'Order', relatedId: result.order.id });
    }

    return NextResponse.json({ success: true, data: { litres, order: result.order, flagged: result.flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
