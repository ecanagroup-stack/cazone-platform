import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Cashier's half of D5's review chain — independent of the supervisor's reading submission, records
// what was actually collected: a cash amount plus itemized POS lines against registered terminals.
// Doesn't touch stock/orders itself; a manager's approval (.../approve) is what makes any of this
// count. Re-recordable while reviewStatus is 'pending' or 'queried'.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'fuel.payments.record')) {
    return NextResponse.json({ error: 'You do not have permission to record fuel payments' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const cashCollected = Math.round(Number(body.cashCollected) || 0);
    const posEntries = Array.isArray(body.posEntries) ? body.posEntries : []; // [{terminalId, amount}]
    if (cashCollected < 0) throw new ApiError('Cash collected cannot be negative', 400);
    for (const p of posEntries) {
      if (!p.terminalId || !Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0) {
        throw new ApiError('Every POS entry needs a terminal and a positive amount', 400);
      }
    }

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading) throw new ApiError('No reading found for this dispenser on this shift', 404);
    if (reading.closing == null) throw new ApiError('The pump reading must be submitted before recording payment', 400);
    if (reading.reviewStatus === 'approved') throw new ApiError('This pump has already been approved', 400);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.posPayment.deleteMany({ where: { meterReadingId: reading.id } });
      if (posEntries.length > 0) {
        await tx.posPayment.createMany({
          data: posEntries.map((p) => ({ meterReadingId: reading.id, terminalId: p.terminalId, amount: Math.round(Number(p.amount)) })),
        });
      }
      return tx.meterReading.update({
        where: { id: reading.id },
        data: { cashCollected, paymentRecordedBy: session.user.id, paymentRecordedAt: new Date() },
        include: { posPayments: { include: { terminal: true } } },
      });
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
