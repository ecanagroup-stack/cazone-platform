// Pure rules for the petroleum distributor ATC module (no database, so they can be tested).

// Customers paying online hold an ATC for this long before it goes back on sale.
export const HOLD_MINUTES = 15;

export const OPEN_STATUSES = ['available', 'reserved', 'sold'];
export const ATC_PAYMENT_METHODS = ['cash', 'transfer', 'pos'];

// The fuels an ATC can be written for. Each gets its own Product on the fuel service (sku ATC-<code>)
// so its price is a normal PriceRule, kept apart from the pump products.
export const ATC_FUEL_TYPES = [
  { code: 'PMS', name: 'ATC - Petrol (PMS)' },
  { code: 'AGO', name: 'ATC - Diesel (AGO)' },
  { code: 'DPK', name: 'ATC - Kerosene (DPK)' },
];

export const atcSku = (code) => `ATC-${code}`;

// Products created for ATC pricing are tagged in attributes so pump and tank pickers can leave them out.
export const ATC_CHANNEL = 'atc';
export function isAtcProduct(product) {
  return product?.attributes?.channel === ATC_CHANNEL;
}

export function formatSerial(seq) {
  return `ATC-${String(seq).padStart(6, '0')}`;
}

// Litres are whole numbers and must fit the truck. `capacity` is null/undefined when the truck has none recorded.
export function parseLitres(value, capacity) {
  const litres = typeof value === 'number' ? value : /^\d+$/.test(String(value ?? '').trim()) ? Number(String(value).trim()) : NaN;
  if (!Number.isSafeInteger(litres) || litres <= 0) throw new Error('Litres must be a whole number greater than zero');
  if (capacity != null && litres > capacity) throw new Error(`This truck holds ${capacity.toLocaleString('en-NG')} litres at most`);
  return litres;
}

// Price per litre (kobo, integer) times litres. Both are integers, so the product is exact as long as it is a safe integer.
export function atcTotalKobo(litres, unitPriceKobo) {
  const unit = Number(unitPriceKobo);
  if (!Number.isSafeInteger(litres) || litres <= 0 || !Number.isSafeInteger(unit) || unit <= 0) throw new Error('Invalid ATC price');
  const total = litres * unit;
  if (!Number.isSafeInteger(total)) throw new Error('ATC total is too large');
  return total;
}

// Naira typed in a form to kobo per litre; rounds the converted amount, not the naira figure.
export function pricePerLitreKobo(naira) {
  const value = Number(naira);
  const kobo = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(kobo) || kobo <= 0) throw new Error('Enter a valid price per litre');
  return kobo;
}

// A reserved ATC whose payment window has passed is as good as available.
export function isHoldLapsed(atc, now = new Date()) {
  return atc.status === 'reserved' && !!atc.reservedUntil && new Date(atc.reservedUntil) <= now;
}

export function isSellable(atc, now = new Date()) {
  return atc.status === 'available' || isHoldLapsed(atc, now);
}

// The same rule as a Prisma `where`, for conditional updates (`updateMany` + count === 1) and lists.
export function sellableWhere(now = new Date()) {
  return { OR: [{ status: 'available' }, { status: 'reserved', reservedUntil: { lte: now } }] };
}

// What a client should see: a lapsed hold reads as available.
export function displayStatus(atc, now = new Date()) {
  return isHoldLapsed(atc, now) ? 'available' : atc.status;
}

export function holdUntil(now = new Date()) {
  return new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
}

// Reference a customer's Paystack charge carries; the server row it is saved on is what ties the payment to the ATC.
export function atcPaystackReference(atcId, now = new Date()) {
  return `atc_${atcId}_${now.getTime()}`;
}

// What a successful Paystack charge means for the ATC its reference was issued for (`atc` is the row found by
// that reference, null when none carries it any more, e.g. the hold lapsed and another buyer took it).
//   apply           the customer's hold is intact and the amount covers the price: sell it
//   already_applied this charge already sold it (webhook redelivery)
//   underpaid       the hold is intact but Paystack collected less than the price: sell nothing, flag a refund
//   conflict        the ATC went elsewhere or was taken off sale: money taken, nothing to give: flag a refund
// A lapsed hold still applies as long as nobody else claimed the ATC, since the paying customer is the only claimant.
export function classifyAtcPayment(atc, { reference, paidKobo }) {
  if (!atc || !reference || atc.paystackReference !== reference) return 'conflict';
  if (atc.status === 'sold' || atc.status === 'delivered') return 'already_applied';
  if (atc.status !== 'reserved' || !atc.reservedByCustomerId) return 'conflict';
  const total = Number(atc.totalPrice);
  if (!Number.isSafeInteger(total) || total <= 0) return 'conflict';
  return Number(paidKobo) >= total ? 'apply' : 'underpaid';
}
