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

export function materialSaleDates({ saleDate, deliveryDate, delivered }) {
  const sale = parseBusinessDate(saleDate, 'Sale date');
  if (!delivered) return { saleDate: sale, deliveryDate: null };
  const delivery = parseBusinessDate(deliveryDate, 'Delivery date');
  if (delivery < sale) throw new Error('Delivery date cannot be before sale date');
  return { saleDate: sale, deliveryDate: delivery };
}

export function todayLocalDate() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
