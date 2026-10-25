import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { atcErrorResponse, atcJson, requireAtcCustomer } from '@/lib/distributor';
import { resolvePrice } from '@/lib/pricing';
import { atcPaystackReference, atcTotalKobo, holdUntil, sellableWhere } from '@/lib/petroleumAtc.mjs';

// Holds an ATC for the customer for HOLD_MINUTES and returns what PaystackButton needs to take payment.
// The reference is saved on the ATC row, so the webhook (app/api/webhooks/paystack, metadata.type ===
// 'atc_order') ties the charge to this exact ATC and checks the amount against the price saved here;
// nothing the browser later sends is trusted. The claim is one conditional update, so two customers
// racing for the same ATC cannot both hold it. Nothing is sold until the payment is confirmed.
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    const { customerId, email: customerEmail, subaccountCode } = await requireAtcCustomer(session);
    if (!subaccountCode) throw new ApiError("This organization isn't set up to collect payments online — ask staff to sell you the ATC", 400);

    const body = await request.json().catch(() => ({}));
    const atcId = String(body.atcId || '');
    const now = new Date();
    const [atc, otherHold] = await Promise.all([
      prisma.petroleumAtc.findFirst({ where: { id: atcId }, select: { id: true, litres: true, productId: true, status: true, reservedByCustomerId: true, reservedUntil: true, paystackReference: true, totalPrice: true } }),
      prisma.petroleumAtc.findFirst({ where: { status: 'reserved', reservedByCustomerId: customerId, reservedUntil: { gt: now }, id: { not: atcId } }, select: { serial: true } }),
    ]);
    if (!atc) throw new ApiError('ATC not found', 404);
    // One hold at a time, so a customer cannot park several ATCs while shopping around.
    if (otherHold) throw new ApiError(`You are already holding ${otherHold.serial} for payment — pay for it or wait for the hold to end`, 409);

    const email = customerEmail || `customer-${customerId}@cazone.app`;

    // Paying again for their own live hold: same reference and price, and the hold is not extended.
    if (atc.status === 'reserved' && atc.reservedByCustomerId === customerId && atc.reservedUntil > now && atc.paystackReference) {
      return atcJson({ success: true, data: { reference: atc.paystackReference, amountKobo: Number(atc.totalPrice), email, subaccountCode } });
    }

    const { price: unitPrice, priceRuleId } = await resolvePrice(atc.productId, customerId);
    const totalPrice = atcTotalKobo(atc.litres, unitPrice);
    const reference = atcPaystackReference(atc.id, now);
    const claimed = await prisma.petroleumAtc.updateMany({
      // Litres and fuel are part of the claim: the price above must be the price of what is being held.
      where: { id: atc.id, litres: atc.litres, productId: atc.productId, ...sellableWhere(now) },
      data: { status: 'reserved', reservedByCustomerId: customerId, reservedUntil: holdUntil(now), paystackReference: reference, unitPrice, totalPrice, priceRuleId },
    });
    if (claimed.count !== 1) throw new ApiError('Someone else just took this ATC — pick another', 409);

    // The check above and the claim are not one step, so two requests for different ATCs can both get through.
    // Count again now that this claim is in: if the customer holds more than one, give this one back.
    const holds = await prisma.petroleumAtc.count({ where: { status: 'reserved', reservedByCustomerId: customerId, reservedUntil: { gt: now } } });
    if (holds > 1) {
      await prisma.petroleumAtc.updateMany({
        where: { id: atc.id, status: 'reserved', paystackReference: reference },
        data: { status: 'available', reservedByCustomerId: null, reservedUntil: null, paystackReference: null },
      });
      throw new ApiError('You are already holding another ATC for payment — pay for it or wait for the hold to end', 409);
    }

    return atcJson({ success: true, data: { reference, amountKobo: totalPrice, email, subaccountCode } });
  } catch (e) {
    return atcErrorResponse(e);
  }
});
