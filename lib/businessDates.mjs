import { operatingDateAt } from './fuelCollections.mjs';
import { parseBusinessDate } from './saleDates.mjs';

// Rows created before business dates existed (or by flows that don't set one) have a null
// business-date column; they fall back to createdAt, read as a Lagos calendar day.
// Africa/Lagos has no daylight saving, so a fixed offset gives its day boundaries.
const LAGOS_OFFSET = '+01:00';

// Instant bounds of the Lagos calendar days [from, to] (YYYY-MM-DD, either may be omitted), for
// timestamp columns such as createdAt or closedAt. Throws on a malformed date.
export function lagosDayRange({ from, to } = {}) {
  const range = {};
  if (from) {
    parseBusinessDate(from, 'From date');
    range.gte = new Date(`${from}T00:00:00.000${LAGOS_OFFSET}`);
  }
  if (to) {
    parseBusinessDate(to, 'To date');
    range.lte = new Date(`${to}T23:59:59.999${LAGOS_OFFSET}`);
  }
  return range;
}

// Prisma `where` fragment selecting rows whose business date — or createdAt, when that is null —
// falls in [from, to]. `from`/`to` are YYYY-MM-DD and either may be omitted. Wrapped in an `AND`
// so spreading it next to a where that has its own `OR` does not overwrite that `OR`.
export function dateRangeWhere(field, { from, to } = {}) {
  if (!from && !to) return {};
  const business = {};
  if (from) business.gte = parseBusinessDate(from, 'From date');
  if (to) {
    parseBusinessDate(to, 'To date');
    business.lte = new Date(`${to}T23:59:59.999Z`);
  }
  return { AND: [{ OR: [{ [field]: business }, { [field]: null, createdAt: lagosDayRange({ from, to }) }] }] };
}

// The YYYY-MM-DD a row belongs to on the business calendar.
export function effectiveDate(row, field) {
  if (row[field]) return new Date(row[field]).toISOString().slice(0, 10);
  return operatingDateAt(new Date(row.createdAt));
}
