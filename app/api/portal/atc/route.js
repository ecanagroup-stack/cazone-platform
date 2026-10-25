import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ATC_CUSTOMER_PAID_SELECT, ATC_CUSTOMER_SELECT, atcErrorResponse, atcJson, requireAtcCustomer } from '@/lib/distributor';
import { resolvePrice } from '@/lib/pricing';
import { atcTotalKobo, sellableWhere } from '@/lib/petroleumAtc.mjs';

// The ATCs a customer can buy, the one they are holding for payment (if any) and their own purchases.
// Before payment they see only serial, fuel, litres and price; the truck and driver appear on their own
// paid ATCs, and the real ATC number is in no response here.
export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    const { customerId, subaccountCode } = await requireAtcCustomer(session);
    const now = new Date();

    const [open, held, mine] = await Promise.all([
      prisma.petroleumAtc.findMany({ where: sellableWhere(now), select: ATC_CUSTOMER_SELECT, orderBy: [{ productId: 'asc' }, { litres: 'asc' }], take: 200 }),
      prisma.petroleumAtc.findMany({ where: { status: 'reserved', reservedByCustomerId: customerId, reservedUntil: { gt: now } }, select: { ...ATC_CUSTOMER_SELECT, totalPrice: true } }),
      prisma.petroleumAtc.findMany({ where: { customerId, status: { in: ['sold', 'delivered'] } }, select: ATC_CUSTOMER_PAID_SELECT, orderBy: { paidAt: 'desc' }, take: 50 }),
    ]);

    // Price per product once for this customer (their negotiated rate if they have one); an ATC with
    // no price set yet is not offered.
    const unitPrices = new Map();
    for (const productId of new Set(open.map((atc) => atc.productId))) {
      try { unitPrices.set(productId, (await resolvePrice(productId, customerId)).price); } catch { /* not priced yet */ }
    }
    const available = open
      .filter((atc) => unitPrices.has(atc.productId))
      .map((atc) => ({
        id: atc.id, serial: atc.serial, fuel: atc.product.name, litres: atc.litres,
        unitPrice: unitPrices.get(atc.productId), totalPrice: atcTotalKobo(atc.litres, unitPrices.get(atc.productId)),
      }));

    return atcJson({
      success: true,
      data: {
        canPayOnline: !!subaccountCode,
        available,
        held: held.map((atc) => ({ id: atc.id, serial: atc.serial, fuel: atc.product.name, litres: atc.litres, totalPrice: atc.totalPrice, reservedUntil: atc.reservedUntil })),
        orders: mine.map((atc) => ({
          id: atc.id, serial: atc.serial, fuel: atc.product.name, litres: atc.litres, status: atc.status,
          unitPrice: atc.unitPrice, totalPrice: atc.totalPrice, paidAt: atc.paidAt, deliveredAt: atc.deliveredAt,
          truckPlate: atc.truckPlate, driverName: atc.driverName, driverPhone: atc.driverPhone,
        })),
      },
    });
  } catch (e) {
    return atcErrorResponse(e);
  }
});
