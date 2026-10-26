import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { ATC_SELECT, ATC_SELLER_SELECT, atcJson, atcProductsWithPrice, readAtcNumber } from '@/lib/distributor';
import { atcTotalKobo, displayStatus, FIRST_SERIAL, formatSerial, isAtcProduct, OPEN_STATUSES, parseLitres, sellableWhere } from '@/lib/petroleumAtc.mjs';

// What the `status` filter means to the board: a lapsed hold counts as available, only a live one is reserved.
function statusWhere(status, now) {
  if (status === 'available') return sellableWhere(now);
  if (status === 'reserved') return { status: 'reserved', reservedUntil: { gt: now } };
  if (['sold', 'delivered', 'cancelled'].includes(status)) return { status };
  return {};
}

// The real ATC number never appears here: ATC_SELECT has no atcNumber column. Staff who may
// only sell see just what is on sale; the sold board (customers, payments) needs atc.view.
export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  const role = session?.user?.role;
  const canView = can(role, 'atc.view');
  if (!canView && !can(role, 'atc.sell')) return atcJson({ error: 'You do not have permission to view ATCs' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const wantsSellable = !canView || searchParams.get('scope') === 'sellable';
    const rows = await prisma.petroleumAtc.findMany({
      where: wantsSellable ? sellableWhere(now) : statusWhere(searchParams.get('status'), now),
      select: canView ? ATC_SELECT : ATC_SELLER_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const rules = await prisma.priceRule.findMany({
      where: { productId: { in: [...new Set(rows.map((r) => r.productId))] }, customerId: null, branchId: null, validTo: null },
      orderBy: { validFrom: 'desc' },
    });
    const atcs = rows.map((row) => {
      const status = displayStatus(row, now);
      const open = ['available', 'reserved'].includes(status);
      const listPrice = open ? rules.find((r) => r.productId === row.productId)?.price ?? null : null;
      return {
        ...row, status,
        // On sale: today's list price. Once sold the snapshot in unitPrice/totalPrice is what counts.
        currentUnitPrice: listPrice,
        currentTotalPrice: listPrice == null ? null : atcTotalKobo(row.litres, listPrice),
      };
    });
    const canManage = can(role, 'atc.manage');
    return atcJson({
      success: true,
      data: {
        atcs,
        products: canManage ? await atcProductsWithPrice() : [],
        permissions: { manage: canManage, sell: can(role, 'atc.sell'), view: canView, viewNumber: ['owner', 'atc_manager'].includes(role) },
      },
    });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.manage')) return atcJson({ error: 'You do not have permission to record an ATC' }, { status: 403 });
  try {
    const body = await request.json();
    const number = readAtcNumber(body);
    const [product, vehicle] = await Promise.all([
      prisma.product.findFirst({ where: { id: String(body.productId || ''), isActive: true } }),
      prisma.vehicle.findFirst({ where: { id: String(body.vehicleId || ''), isActive: true, type: 'tanker' } }),
    ]);
    if (!product || !isAtcProduct(product)) throw new ApiError('Choose the fuel type', 400);
    if (!vehicle) throw new ApiError('Choose a tanker', 400);
    if (vehicle.capacity == null) throw new ApiError(`Set ${vehicle.plateNumber}'s capacity before recording an ATC on it`, 400);
    const litres = parseLitres(body.litres, vehicle.capacity);

    const [duplicate, onTruck] = await Promise.all([
      prisma.petroleumAtc.findFirst({ where: { atcNumber: number.atcNumber }, select: { serial: true, status: true } }),
      prisma.petroleumAtc.findFirst({ where: { vehicleId: vehicle.id, status: { in: OPEN_STATUSES } }, select: { serial: true } }),
    ]);
    if (duplicate) throw new ApiError(`That ATC number is already recorded as ${duplicate.serial}${duplicate.status === 'cancelled' ? ' (cancelled; a number stays reserved once recorded)' : ''}`, 409);
    if (onTruck) throw new ApiError(`${vehicle.plateNumber} already carries ${onTruck.serial} — deliver or cancel it first`, 409);

    let atc;
    try {
      atc = await prisma.$transaction(async (tx) => {
        const counter = await tx.counter.upsert({
          where: { organizationId_key: { organizationId: session.user.organizationId, key: 'petroleumAtc' } },
          update: { seq: { increment: 1 } }, create: { key: 'petroleumAtc', seq: FIRST_SERIAL },
        });
        return tx.petroleumAtc.create({
          data: {
            serial: formatSerial(counter.seq), productId: product.id, vehicleId: vehicle.id, litres, ...number,
            notes: String(body.notes || '').trim() || null, createdBy: session.user.id,
          },
          select: ATC_SELECT,
        });
      }, { timeout: 15000 });
    } catch (error) {
      // A concurrent request won the number or the truck between the checks above and this insert.
      if (error.code === 'P2002') throw new ApiError('That ATC number is already recorded, or this truck already carries an open ATC', 409);
      throw error;
    }

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.created', entityType: 'PetroleumAtc', entityId: atc.id,
      after: { serial: atc.serial, fuel: product.name, litres, truck: vehicle.plateNumber },
    });
    return atcJson({ success: true, data: atc }, { status: 201 });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
