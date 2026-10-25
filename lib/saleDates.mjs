import { operatingDateAt } from './fuelCollections.mjs';

// Business dates are stored at UTC midnight; createdAt/deliveredAt retain the audit timestamps.
export function parseBusinessDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a valid date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid date`);
  }
  return date;
}

// Today on the business calendar (Africa/Lagos), as YYYY-MM-DD. Server and browser agree on it
// whatever their own timezone, so a sale entered at 00:30 Lagos is never "yesterday" or "tomorrow".
export function businessToday(now = new Date()) {
  return operatingDateAt(now);
}

const isoDay = (value) => (typeof value === 'string' ? value : value.toISOString().slice(0, 10));

// `date` is a YYYY-MM-DD string or a Date at UTC midnight (what parseBusinessDate returns).
// A malformed string throws, so it can never slip past the back-dating gate.
export function isBackdated(date, now = new Date()) {
  const day = isoDay(date);
  parseBusinessDate(day, 'Date');
  return day < businessToday(now);
}

export function assertNotFuture(date, label, now = new Date()) {
  if (isoDay(date) > businessToday(now)) throw new Error(`${label} cannot be in the future`);
  return date;
}

// For writers where the date is optional (payments, adjustments, deposits, retail sales): blank means
// "today" and is left null so the row falls back to createdAt; anything else must be a real date that
// is not in the future.
export function optionalBusinessDate(value, label, now = new Date()) {
  if (value == null || value === '') return null;
  return assertNotFuture(parseBusinessDate(value, label), label, now);
}

// The date a back-dated row's timestamp (StockMove.at, receivedAt, assignedAt...) is stamped with, or
// undefined for "now" — blank and today's date both mean the entry is being made as it happens.
export function backdatedAt(date, now = new Date()) {
  return date && isBackdated(date, now) ? date : undefined;
}

// A later stage of one record (loading after assigning) cannot be dated before the stage it follows;
// `earlierDay` is that stage's YYYY-MM-DD.
export function assertNotBefore(date, earlierDay, label) {
  if (earlierDay && isoDay(date) < earlierDay) throw new Error(`${label} cannot be before ${earlierDay}`);
  return date;
}

export function materialSaleDates({ saleDate, deliveryDate, delivered }, now = new Date()) {
  const sale = assertNotFuture(parseBusinessDate(saleDate, 'Sale date'), 'Sale date', now);
  if (!delivered) return { saleDate: sale, deliveryDate: null };
  const delivery = assertNotFuture(parseBusinessDate(deliveryDate, 'Delivery date'), 'Delivery date', now);
  if (delivery < sale) throw new Error('Delivery date cannot be before sale date');
  return { saleDate: sale, deliveryDate: delivery };
}

export function todayLocalDate() {
  return businessToday();
}
