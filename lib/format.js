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

export function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
