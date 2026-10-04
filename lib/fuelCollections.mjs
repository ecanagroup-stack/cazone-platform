export function operatingDateAt(instant = new Date(), timeZone = 'Africa/Lagos') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

// Keep overnight work on the date when its shift opened. After a shift closes,
// keep showing it for the rest of the local day on which it closed.
export function displayedFuelOperatingDate(shifts, now = new Date()) {
  const today = operatingDateAt(now);
  const open = shifts.find((shift) => shift.status === 'open');
  if (open) return open.operatingDate || operatingDateAt(new Date(open.openedAt));
  const recent = shifts[0];
  if (recent && (recent.operatingDate === today ||
    (recent.closedAt && operatingDateAt(new Date(recent.closedAt)) === today))) {
    return recent.operatingDate || operatingDateAt(new Date(recent.openedAt));
  }
  return today;
}

function millilitres(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Meter readings must be non-negative finite numbers');
  const raw = String(value).toLowerCase().includes('e') ? number.toFixed(9) : String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error('Invalid meter reading');
  const fraction = match[2] || '';
  return BigInt(match[1]) * 1000n + BigInt(fraction.slice(0, 3).padEnd(3, '0')) +
    (fraction[3] && fraction[3] >= '5' ? 1n : 0n);
}

export function exactMeterSale({ opening, closing, rtt = 0, creditLitres = 0, priceKobo }) {
  const volume = millilitres(closing) - millilitres(opening) - millilitres(rtt) - millilitres(creditLitres);
  if (volume < 0n) throw new Error('Returns and credit fills exceed litres dispensed');
  if (!Number.isSafeInteger(priceKobo) || priceKobo < 0) throw new Error('Invalid fuel price');
  const amount = (volume * BigInt(priceKobo) + 500n) / 1000n;
  if (volume > BigInt(Number.MAX_SAFE_INTEGER) || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fuel sale exceeds the safe range');
  return { litres: Number(volume) / 1000, expectedAmount: Number(amount) };
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
  const sales = readings.filter((reading) => (reading.productIdAtShift || reading.dispenser.tank?.productId) === productId)
    .reduce((sum, reading) => sum + Math.max(0, reading.litres == null
      ? reading.closing - reading.opening - reading.rtt : reading.litres + (reading.creditLitres || 0)), 0);
  return { opening, receipts, sales, book: opening + receipts - sales, measured };
}
