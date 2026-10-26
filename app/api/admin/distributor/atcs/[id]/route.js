import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { ATC_SELECT, atcJson, readAtcNumber } from '@/lib/distributor';
import { isAtcProduct, isSellable, OPEN_STATUSES, parseLitres, sellableWhere } from '@/lib/petroleumAtc.mjs';

// Edits an ATC that is still on sale. The real number is changed only by entering it twice again, and
// is never returned or logged. A sold, delivered or cancelled ATC is a record, not an edit target.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.manage')) return atcJson({ error: 'You do not have permission to edit an ATC' }, { status: 403 });
  try {
    const { id } = await params;
    const body = await request.json();
    const existing = await prisma.petroleumAtc.findFirst({
      where: { id }, select: { id: true, serial: true, productId: true, vehicleId: true, litres: true, status: true, reservedUntil: true },
    });
    if (!existing) throw new ApiError('ATC not found', 404);
    const now = new Date();
    if (!isSellable(existing, now)) throw new ApiError('Only an ATC that is still on sale can be edited', 409);

    const data = {};
    const changed = [];
    if (body.atcNumber || body.atcNumberConfirm) {
      const number = readAtcNumber(body);
      const duplicate = await prisma.petroleumAtc.findFirst({ where: { atcNumber: number.atcNumber, id: { not: id } }, select: { serial: true, status: true } });
      if (duplicate) throw new ApiError(`That ATC number is already recorded as ${duplicate.serial}${duplicate.status === 'cancelled' ? ' (cancelled; a number stays reserved once recorded)' : ''}`, 409);
      Object.assign(data, number);
      changed.push('atcNumber');
    }
    if (body.productId && body.productId !== existing.productId) {
      const product = await prisma.product.findFirst({ where: { id: String(body.productId), isActive: true } });
      if (!product || !isAtcProduct(product)) throw new ApiError('Choose the fuel type', 400);
      data.productId = product.id;
      changed.push('fuel');
    }

    let vehicleId = existing.vehicleId;
    if (body.vehicleId && body.vehicleId !== existing.vehicleId) {
      vehicleId = String(body.vehicleId);
      changed.push('truck');
    }
    const litresInput = 'litres' in body ? body.litres : existing.litres;
    if (changed.includes('truck') || 'litres' in body) {
      const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, isActive: true, type: 'tanker' } });
      if (!vehicle) throw new ApiError('Choose a tanker', 400);
      if (vehicle.capacity == null) throw new ApiError(`Set ${vehicle.plateNumber}'s capacity before recording an ATC on it`, 400);
      const litres = parseLitres(litresInput, vehicle.capacity);
      if (changed.includes('truck')) {
        const onTruck = await prisma.petroleumAtc.findFirst({ where: { vehicleId, status: { in: OPEN_STATUSES }, id: { not: id } }, select: { serial: true } });
        if (onTruck) throw new ApiError(`${vehicle.plateNumber} already carries ${onTruck.serial} — deliver or cancel it first`, 409);
        data.vehicleId = vehicleId;
      }
      if (litres !== existing.litres) { data.litres = litres; changed.push('litres'); }
    }
    if ('notes' in body) {
      data.notes = String(body.notes || '').trim() || null;
      changed.push('notes');
    }
    if (changed.length === 0) throw new ApiError('No changes submitted', 400);

    // A lapsed online hold goes back to plain available; the old Paystack reference stays on the row
    // so a late payment against it is recognised as a conflict instead of selling the edited ATC.
    Object.assign(data, { status: 'available', reservedUntil: null, reservedByCustomerId: null });
    let claimed;
    try {
      claimed = await prisma.petroleumAtc.updateMany({ where: { id, ...sellableWhere(now) }, data });
    } catch (error) {
      if (error.code === 'P2002') throw new ApiError('That ATC number is already recorded, or this truck already carries an open ATC', 409);
      throw error;
    }
    if (claimed.count !== 1) throw new ApiError('This ATC was just taken and can no longer be edited', 409);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.updated', entityType: 'PetroleumAtc', entityId: id, after: { serial: existing.serial, changed },
    });
    const atc = await prisma.petroleumAtc.findFirst({ where: { id }, select: ATC_SELECT });
    return atcJson({ success: true, data: atc });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
