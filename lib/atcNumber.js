// The real ATC number is kept as plain text, but only the ATC manager and the Admin may read it
// (one ATC at a time, through an audited action). Customers and sales staff only ever see the
// in-house serial. Every ATC query uses an explicit select without this column; the guard below is
// the last line of defence behind those selects.
// Plain JS with no Next.js aliases, so the tests can import it directly.

const SENSITIVE_KEYS = new Set(['atcNumber']);

// Case and spacing are noise when the same number is typed twice or retyped later; the normalised
// form is what is stored, so the duplicate check is exact.
export function normalizeAtcNumber(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

// True when a value about to be sent to a client carries the number column anywhere inside it.
export function hasAtcNumberLeak(value) {
  if (Array.isArray(value)) return value.some(hasAtcNumberLeak);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).some(([key, item]) => SENSITIVE_KEYS.has(key) || hasAtcNumberLeak(item));
  }
  return false;
}

export function assertNoAtcNumber(value) {
  if (hasAtcNumberLeak(value)) throw Object.assign(new Error('Refusing to send the ATC number to the client'), { status: 500 });
  return value;
}
