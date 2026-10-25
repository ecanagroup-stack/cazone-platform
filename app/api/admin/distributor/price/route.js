import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { atcJson, atcProductsWithPrice } from '@/lib/distributor';
import { setPrice } from '@/lib/pricing';
import { notifyAlteration } from '@/lib/notify';
import { isAtcProduct, pricePerLitreKobo } from '@/lib/petroleumAtc.mjs';

// The Admin sets the ATC price per litre directly; a manager's change to an already-priced fuel waits
// for the Admin's approval like any other price (lib/pricing.js setPrice) and shows up under Price Approvals.
const canSetPrice = (role) => ['owner', 'manager'].includes(role);

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const role = session?.user?.role;
  if (!canSetPrice(role) && !can(role, 'atc.manage') && !can(role, 'atc.view')) return atcJson({ error: 'Forbidden' }, { status: 403 });
  const products = await atcProductsWithPrice({ create: canSetPrice(role) || can(role, 'atc.manage') });
  const pending = await prisma.priceHistory.findMany({
    where: { productId: { in: products.map((p) => p.id) }, status: 'pending' },
    select: { productId: true, newPrice: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return atcJson({
    success: true,
    data: { products: products.map((p) => ({ ...p, pendingPrice: pending.find((h) => h.productId === p.id)?.newPrice ?? null })), canSetPrice: canSetPrice(role) },
  });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!canSetPrice(session?.user?.role)) return atcJson({ error: 'Only the Admin or a manager can set the ATC price' }, { status: 403 });
  try {
    const body = await request.json();
    const reason = String(body.reason || '').trim();
    if (!reason) throw new ApiError('Give a reason for the price change', 400);
    const price = pricePerLitreKobo(body.price);
    const product = await prisma.product.findFirst({ where: { id: String(body.productId || ''), isActive: true } });
    if (!product || !isAtcProduct(product)) throw new ApiError('Choose a fuel type', 400);

    const result = await prisma.$transaction((tx) => setPrice(tx, product.id, price, { id: session.user.id, role: session.user.role }, reason), { timeout: 15000 });
    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.price.updated', entityType: 'Product', entityId: product.id, after: { price, reason, pending: result.pending },
    });
    if (result.pending) {
      await notifyAlteration({
        actor: session.user, type: 'price_proposed', title: 'ATC price change awaiting approval',
        message: `${session.user.name} proposed a new price for ${product.name}`, relatedType: 'Product', relatedId: product.id,
      });
    }
    return atcJson({
      success: true, data: { price: result.rule.price },
      ...(result.pending && { pricePending: true, message: 'Price change submitted for Admin approval — the current price is unchanged until then' }),
    });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
