// Naira (as typed in a form) to kobo for storage. Rounds the converted amount, not the naira figure
// first: 1500.75 must become 150075, not 150000.
export function toCents(value) {
  const cents = Math.round((Number(value) || 0) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large');
  return cents;
}
