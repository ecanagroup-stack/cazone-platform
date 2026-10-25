const CURRENCY_LOCALE = { NGN: 'en-NG', USD: 'en-US', GBP: 'en-GB' };

export function formatMoney(amount, currency = 'NGN') {
  const value = Number(amount || 0);
  return value.toLocaleString(CURRENCY_LOCALE[currency] || 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Delivery totals use integer minor units in PostgreSQL BIGINT. Keep them as a decimal string
// across APIs and only format here, so display does not lose precision through JavaScript Number.
export function formatMinorMoney(minorUnits, currency = 'NGN') {
  if (minorUnits == null) return '—';
  const amount = BigInt(minorUnits);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const major = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const locale = CURRENCY_LOCALE[currency] || 'en-US';
  const majorText = new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(major);
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
  return `${negative ? '-' : ''}${majorText}${decimal}${fraction}`;
}

export function minorUnitsToDecimal(minorUnits) {
  if (minorUnits == null) return '';
  const amount = BigInt(minorUnits);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function formatDate(date) {
  if (!date) return '—';
  // A bare YYYY-MM-DD is a business date, not an instant: print that calendar day in any timezone.
  const dateOnly = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return new Date(date).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

export function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// An instant (paid, delivered) with its time, unlike formatDate's calendar day.
export function formatDateTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
