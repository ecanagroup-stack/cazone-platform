export function operatingDateAt(instant = new Date(), timeZone = 'Africa/Lagos') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function summarizePumpCollection(expectedAmount, collections = []) {
  const expected = Math.max(0, Math.round(expectedAmount || 0));
  const active = collections.filter((row) => !row.voidedAt);
  const cash = active.reduce((sum, row) => sum + row.cashAmount, 0);
  const pos = active.reduce((sum, row) => sum + row.posAmount, 0);
  const collected = cash + pos;
  return { expected, cash, pos, collected, outstanding: Math.max(0, expected - collected), overage: Math.max(0, collected - expected) };
}

export function validateCollectionInput(cashAmount, posEntries) {
  if (!Number.isSafeInteger(cashAmount) || cashAmount < 0) throw new Error('Cash must be a non-negative amount in kobo');
  if (!Array.isArray(posEntries)) throw new Error('POS entries must be a list');
  for (const entry of posEntries) {
    if (!entry.terminalId || !Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
      throw new Error('Every POS entry needs a terminal and a positive amount in kobo');
    }
  }
  const posAmount = posEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalAmount = cashAmount + posAmount;
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) throw new Error('Enter a cash or POS amount greater than zero');
  return { cashAmount, posAmount, totalAmount };
}

export function overdueShiftBlockers(readings, tanks, closingDips, collections) {
  const blockers = [];
  if (!readings.length || readings.some((reading) => reading.closing == null || reading.reviewStatus !== 'approved')) {
    blockers.push('pump readings awaiting supervisor submission or manager approval');
  }
  if (tanks.some((tank) => !closingDips.some((dip) => dip.tankId === tank.id))) {
    blockers.push('closing tank stock missing');
  }
  if (readings.some((reading) => reading.litres > 0 && !collections.some((collection) =>
    collection.meterReadingId === reading.id && !collection.voidedAt && collection.collectionType === 'initial' && collection.totalAmount > 0))) {
    blockers.push('initial collection missing for a selling pump');
  }
  return blockers;
}

export function summarizeTankProduct(productId, tanks, openingDips, closingDips, readings, purchases, ledgerOpening = 0) {
  const productTanks = tanks.filter((tank) => tank.productId === productId);
  const tankIds = new Set(productTanks.map((tank) => tank.id));
  const measured = closingDips.filter((dip) => tankIds.has(dip.tankId)).reduce((sum, dip) => sum + dip.measured, 0);
  const openingEntries = openingDips.filter((dip) => tankIds.has(dip.tankId));
  const opening = openingEntries.length === productTanks.length
    ? openingEntries.reduce((sum, dip) => sum + dip.measured, 0) : ledgerOpening;
  const receipts = purchases.reduce((sum, move) => sum + move.qty, 0);
  const sales = readings.filter((reading) => reading.dispenser.tank?.productId === productId)
    .reduce((sum, reading) => sum + Math.max(0, reading.closing - reading.opening - reading.rtt), 0);
  return { opening, receipts, sales, book: opening + receipts - sales, measured };
}
