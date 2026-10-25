import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { ATC_SELECT, atcJson } from '@/lib/distributor';
import { resolvePrice } from '@/lib/pricing';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { notifyRoleUsers } from '@/lib/notify';
import { formatMoney } from '@/lib/format';
import { ATC_PAYMENT_METHODS, atcTotalKobo, sellableWhere } from '@/lib/petroleumAtc.mjs';

// Customers a seller may sell an ATC to: active, and (for branch-restricted staff) registered at one of
// their branches, like every other customer lookup.
async function customerWhere(session) {
  const branchIds = await getAccessibleBranchIds(session);
  return { isActive: true, ...(branchIds === null ? {} : { access: { some: { branchId: { in: branchIds } } } }) };
}

export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.sell')) return atcJson({ error: 'You do not have permission to sell ATCs' }, { status: 403 });
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return atcJson({ success: true, data: [] });
  const customers = await prisma.customer.findMany({
    where: {
      ...(await customerWhere(session)),
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { businessName: { contains: q, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, phone: true, businessName: true },
    take: 10,
    orderBy: { name: 'asc' },
  });
  return atcJson({ success: true, data: customers });
});

// Sells an ATC to a customer on the spot: the buyer pays staff (cash, transfer or POS), so the ATC goes
// straight to sold. Prepaid only — no credit. The claim is a single conditional update, so two sellers
// racing for the same ATC cannot both win; the loser gets a 409.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.sell')) return atcJson({ error: 'You do not have permission to sell ATCs' }, { status: 403 });
  try {
    const body = await request.json();
    const paymentMethod = String(body.paymentMethod || '');
    if (!ATC_PAYMENT_METHODS.includes(paymentMethod)) throw new ApiError('Choose how the customer paid: cash, transfer or POS', 400);

    const customer = await prisma.customer.findFirst({
      where: { id: String(body.customerId || ''), isActive: true },
      select: { id: true, name: true, access: { select: { branchId: true } } },
    });
    const branchIds = await getAccessibleBranchIds(session);
    if (!customer || (branchIds !== null && !customer.access.some((a) => canAccessBranch(branchIds, a.branchId)))) throw new ApiError('Customer not found', 404);

    const atc = await prisma.petroleumAtc.findFirst({
      where: { id: String(body.atcId || '') },
      select: { id: true, serial: true, productId: true, vehicleId: true, litres: true, product: { select: { name: true } }, vehicle: { select: { plateNumber: true, driverName: true, driverPhone: true } } },
    });
    if (!atc) throw new ApiError('ATC not found', 404);

    // Prices are set beforehand; the seller never types one.
    const { price: unitPrice, priceRuleId } = await resolvePrice(atc.productId, customer.id);
    const totalPrice = atcTotalKobo(atc.litres, unitPrice);

    const now = new Date();
    const claimed = await prisma.petroleumAtc.updateMany({
      // Litres, fuel and truck are part of the claim: an edit landing after the read above would otherwise
      // be sold at the price (and with the driver snapshot) of the old values.
      where: { id: atc.id, litres: atc.litres, productId: atc.productId, vehicleId: atc.vehicleId, ...sellableWhere(now) },
      data: {
        status: 'sold', customerId: customer.id, paymentMethod, unitPrice, totalPrice, priceRuleId,
        paidAt: now, soldAt: now, soldBy: session.user.id, reservedUntil: null, reservedByCustomerId: null,
        truckPlate: atc.vehicle.plateNumber, driverName: atc.vehicle.driverName, driverPhone: atc.vehicle.driverPhone,
      },
    });
    if (claimed.count !== 1) throw new ApiError('Someone else just took this ATC — pick another', 409);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.sold', entityType: 'PetroleumAtc', entityId: atc.id,
      after: { serial: atc.serial, customerId: customer.id, litres: atc.litres, unitPrice, totalPrice, paymentMethod },
    });
    await notifyRoleUsers(['atc_manager', 'owner'], {
      exceptUserId: session.user.id, type: 'atc_sold', title: 'ATC sold',
      message: `${atc.serial} (${atc.litres.toLocaleString('en-NG')} L ${atc.product.name}) sold to ${customer.name} for ${formatMoney(totalPrice / 100)}. Truck ${atc.vehicle.plateNumber}.`,
      relatedType: 'PetroleumAtc', relatedId: atc.id,
    });

    const sold = await prisma.petroleumAtc.findFirst({ where: { id: atc.id }, select: ATC_SELECT });
    return atcJson({ success: true, data: sold });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
