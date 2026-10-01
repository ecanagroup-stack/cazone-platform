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
