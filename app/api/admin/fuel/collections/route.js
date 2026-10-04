import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { summarizePumpCollection, displayedFuelOperatingDate } from '@/lib/fuelCollections.mjs';
import { ApiError } from '@/lib/apiError';

// Daily supervisor sales and each pump's collection history, including balances on closed shifts.
export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const requestedDate = url.searchParams.get('date');
    if (!branchId || (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))) throw new ApiError('Branch and valid YYYY-MM-DD date are required', 400);
    const access = await getAccessibleBranchIds(session);
    if (!canAccessBranch(access, branchId)) throw new ApiError('Access denied to this branch', 403);
    let date = requestedDate;
    if (!date) {
      const [open, recent] = await Promise.all([
        prisma.shift.findFirst({ where: { branchId, status: 'open' }, orderBy: { openedAt: 'desc' },
          select: { operatingDate: true, openedAt: true, closedAt: true, status: true } }),
        prisma.shift.findFirst({ where: { branchId }, orderBy: { openedAt: 'desc' },
          select: { operatingDate: true, openedAt: true, closedAt: true, status: true } }),
      ]);
      date = displayedFuelOperatingDate([open, recent].filter(Boolean));
    }
    const shifts = await prisma.shift.findMany({ where: { branchId, operatingDate: date }, orderBy: { openedAt: 'asc' } });
    if (!shifts.length) return NextResponse.json({ success: true, data: { date, rows: [], byProduct: [], shifts: [], deposits: [] } });
    const shiftIds = shifts.map((shift) => shift.id);
    const [readings, collections, assignments, terminals, deposits] = await Promise.all([
      prisma.meterReading.findMany({ where: { shiftId: { in: shiftIds } }, include: {
        dispenser: { include: { tank: { include: { product: true } } } },
      } }),
      prisma.fuelCollection.findMany({ where: { shiftId: { in: shiftIds } }, orderBy: { createdAt: 'asc' } }),
      prisma.attendantAssignment.findMany({ where: { shiftId: { in: shiftIds } }, include: { attendant: true }, orderBy: { assignedAt: 'desc' } }),
      prisma.posTerminal.findMany({ where: { branchId, isActive: true }, orderBy: { label: 'asc' } }),
      prisma.cashDeposit.findMany({ where: { shiftId: { in: shiftIds } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const shiftById = Object.fromEntries(shifts.map((shift) => [shift.id, shift]));
    const historicalProductIds = [...new Set(readings.map((reading) => reading.productIdAtShift).filter(Boolean))];
    const historicalProducts = await prisma.product.findMany({ where: { id: { in: historicalProductIds } }, select: { id: true, name: true } });
    const historicalProductById = Object.fromEntries(historicalProducts.map((product) => [product.id, product]));
    const rows = readings.map((reading) => {
      const history = collections.filter((collection) => collection.meterReadingId === reading.id);
      const assignment = assignments.find((a) => a.shiftId === reading.shiftId && a.dispenserId === reading.dispenserId);
      return {
        shiftId: reading.shiftId, shiftStatus: shiftById[reading.shiftId].status,
        shiftLabel: shiftById[reading.shiftId].shiftLabel, dispenserId: reading.dispenserId,
        dispenserLabel: reading.dispenser.label, productName: historicalProductById[reading.productIdAtShift]?.name || reading.dispenser.tank?.product?.name || 'Unknown',
        attendantName: assignment?.attendant.name || null, readingStatus: reading.reviewStatus,
        litres: reading.closing == null ? null : reading.litres, expectedAmount: reading.expectedAmount,
        ...summarizePumpCollection(reading.expectedAmount, history), collections: history,
        collectionCoverage: reading.collectionCoverage,
        ...(reading.collectionCoverage === 'unknown' ? { outstanding: null } : {}),
      };
    });
    const byProduct = Object.values(rows.filter((row) => row.litres != null).reduce((acc, row) => {
      const summary = acc[row.productName] || { product: row.productName, litres: 0, expectedAmount: 0 };
      summary.litres += row.litres || 0;
      summary.expectedAmount += row.expectedAmount || 0;
      acc[row.productName] = summary;
      return acc;
    }, {}));
    return NextResponse.json({ success: true, data: { date, rows, byProduct, terminals, shifts, deposits } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}, 'fuel_station');
