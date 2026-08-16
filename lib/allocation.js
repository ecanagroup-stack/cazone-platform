import prisma from './prisma';

// Ported from the old shop app's ATC lifecycle (lib/atcLifecycle.js there) — a Delivery started as
// an allocation (qtyRemaining set) moves pending -> assigned -> loaded -> arrived as a vehicle
// collects a pre-paid batch, then -> closed as sales draw it down (see lib/sale.js). A batch left
// "loaded" too long is presumed arrived automatically, same as the old app.
export const LOADING_WINDOW_HOURS = 6;
export const LOADING_WINDOW_MS = LOADING_WINDOW_HOURS * 60 * 60 * 1000;

// Called at the top of the deliveries GET route — same "check on every read" pattern as the old app,
// no separate scheduler needed.
export async function autoArriveDueAllocations() {
  const cutoff = new Date(Date.now() - LOADING_WINDOW_MS);
  const due = await prisma.delivery.findMany({
    where: { status: 'loaded', loadedAt: { lte: cutoff } },
  });
  for (const d of due) {
    await prisma.delivery.update({
      where: { id: d.id },
      data: { status: 'arrived', arrivalDate: d.arrivalDate || new Date(d.loadedAt.getTime() + LOADING_WINDOW_MS) },
    });
  }
  return due.length;
}

// An allocation is sellable once it's physically reachable (loaded or arrived) and not drawn down —
// mirrors the old app's `availableForSale` filter.
export function isAllocationSellable(delivery) {
  return delivery.qtyRemaining != null && delivery.qtyRemaining > 0 && ['loaded', 'arrived'].includes(delivery.status);
}
