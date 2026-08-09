// Growable catalog of verticals an organization can switch on. Adding a new one is a list edit here,
// not a schema migration — Service.type is a validated string, not a Postgres enum.
export const SERVICE_TYPES = [
  { id: 'fuel_station', label: 'Petrol Station' },
  { id: 'shop', label: 'Shop / Materials' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'hotel', label: 'Hotel & Hospitality' },
];

export const SERVICE_TYPE_IDS = SERVICE_TYPES.map((s) => s.id);

export function serviceLabel(type) {
  return SERVICE_TYPES.find((s) => s.id === type)?.label || type;
}

export function isValidServiceType(type) {
  return SERVICE_TYPE_IDS.includes(type);
}
