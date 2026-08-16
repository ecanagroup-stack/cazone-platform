import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { computePeriod, evaluateVariance } from '@/lib/reconciliation';
import { ApiError } from '@/lib/apiError';

// Fuel typically runs well under 1% variance (core-algorithms skill §5) — this default applies
// whenever a branch hasn't set its own tolerance via Fuel Setup > Station Config (F1).
const DEFAULT_FUEL_TOLERANCE_PCT = 0.5;

// A tank dip — the fuel-specific "measured" input into the shared bulk-reconciliation abstraction.
// Reconciliation itself is keyed by (branchId, productId), same as the stock ledger, not by the
// physical tank — a branch with two tanks of the same product already doesn't distinguish between
// them for stock purposes (established in the fuel shift pass), and this doesn't change that.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'stock.receive')) {
    return NextResponse.json({ error: 'You do not have permission to record a tank dip' }, { status: 403 });
  }
  try {
    const { id: tankId } = await params;
    const body = await request.json();
    const measured = Number(body.measured);
    if (!Number.isFinite(measured) || measured < 0) throw new ApiError('Measured litres must be a non-negative number', 400);

    const tank = await prisma.tank.findUnique({ where: { id: tankId }, include: { branch: { select: { config: true } } } });
    if (!tank) throw new ApiError('Tank not found', 404);
    const tolerancePct = Number(tank.branch.config?.reconciliationTolerancePct) || DEFAULT_FUEL_TOLERANCE_PCT;

    const lastRecon = await prisma.reconciliation.findFirst({
      where: { branchId: tank.branchId, productId: tank.productId },
      orderBy: { periodEnd: 'desc' },
    });
    const periodStart = lastRecon ? lastRecon.periodEnd : tank.createdAt;
    const periodEnd = new Date();

    const { opening, receipts, sales, book } = await computePeriod(tank.branchId, tank.productId, periodStart, periodEnd);
    const { variance, variancePct, status } = evaluateVariance(book, measured, receipts, tolerancePct);

    const reconciliation = await prisma.$transaction(async (tx) => {
      const created = await tx.reconciliation.create({
        data: {
          branchId: tank.branchId, productId: tank.productId, periodStart, periodEnd,
          opening, receipts, sales, book, measured, variance, variancePct, tolerance: tolerancePct,
          status,
        },
      });

      if (status === 'exception') {
        await tx.flag.create({
          data: {
            branchId: tank.branchId, targetType: 'Reconciliation', targetId: created.id,
            severity: 'concern', classification: 'concern',
            reason: `Tank dip variance of ${variance.toFixed(1)}L (${variancePct.toFixed(2)}%) on ${tank.label}, outside ${tolerancePct}% tolerance`,
            raisedBy: session.user.id,
          },
        });
      }

      return created;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: reconciliation }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
