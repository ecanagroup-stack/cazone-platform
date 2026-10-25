import { NextResponse } from 'next/server';
import prisma from './prisma';
import { hasActiveDistributorAddon } from './customerAccess.mjs';
import { jsonSafe } from './jsonSafe';
import { assertNoAtcSecrets, encryptAtcNumber, hashAtcNumber, normalizeAtcNumber } from './atcSecret';
import { ApiError } from './apiError';
import { ATC_CHANNEL, ATC_FUEL_TYPES, atcSku, isAtcProduct } from './petroleumAtc.mjs';

// Whether this organization has the Petroleum Distributor add-on switched on right now. Read live on
// every request (never put in the JWT) so a lapse takes effect at once. BusinessAddon is not
// tenant-scoped, so the organizationId filter is the only thing keeping orgs apart.
export async function hasActiveDistributor(organizationId) {
  const addons = await prisma.businessAddon.findMany({
    where: { organizationId, type: 'distributor', status: 'active' },
    select: { type: true, status: true, endsAt: true },
  });
  return hasActiveDistributorAddon(addons);
}

// Creates, once, the per-fuel products ATC prices hang off (sku ATC-PMS ...), tagged
// attributes.channel = 'atc' so pump and tank pickers skip them. Called lazily whenever the
// distributor pages need them rather than at add-on activation, so an add-on approved before this
// code existed still works. Returns the ATC products of the fuel service, oldest first. Read-only
// callers pass create: false so a GET never writes.
export async function ensureAtcProducts({ create = true } = {}) {
  const service = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { id: true } });
  if (!service) return [];
  const load = () => prisma.product.findMany({ where: { serviceId: service.id, sku: { startsWith: 'ATC-' } }, orderBy: { createdAt: 'asc' } });
  let products = await load();
  if (!create) return products.filter(isAtcProduct);
  for (const { code, name } of ATC_FUEL_TYPES) {
    if (products.some((p) => p.sku === atcSku(code))) continue;
    try {
      await prisma.product.create({ data: { serviceId: service.id, sku: atcSku(code), name, unit: 'litre', attributes: { channel: ATC_CHANNEL, fuelType: code } } });
    } catch (error) {
      if (error.code !== 'P2002') throw error; // a concurrent request created it first
    }
    products = await load();
  }
  return products.filter(isAtcProduct);
}

// ATC products with their open org-wide price per litre (kobo), null when none is set yet.
export async function atcProductsWithPrice(options) {
  const products = await ensureAtcProducts(options);
  const rules = await prisma.priceRule.findMany({
    where: { productId: { in: products.map((p) => p.id) }, customerId: null, branchId: null, validTo: null },
    orderBy: { validFrom: 'desc' },
  });
  return products.map((p) => ({
    id: p.id, name: p.name, sku: p.sku, isActive: p.isActive,
    pricePerLitre: rules.find((r) => r.productId === p.id)?.price ?? null,
  }));
}

// Everything a client may ever see of an ATC. The real number (atcHash/atcCipher) is deliberately
// absent: every ATC query goes through an explicit select like this one.
export const ATC_SELECT = {
  id: true, serial: true, litres: true, status: true, reservedUntil: true,
  unitPrice: true, totalPrice: true, paymentMethod: true, paidAt: true, soldAt: true, deliveredAt: true,
  truckPlate: true, driverName: true, driverPhone: true, notes: true, createdAt: true,
  productId: true, product: { select: { id: true, name: true, sku: true } },
  vehicleId: true, vehicle: { select: { id: true, plateNumber: true, driverName: true, driverPhone: true, capacity: true } },
  customerId: true, customer: { select: { id: true, name: true, phone: true, businessName: true } },
};

// What a seller (atc.sell without atc.view) sees of an ATC on sale: no truck, driver or customer, since
// the fulfilment details are shown only once it is paid for.
export const ATC_SELLER_SELECT = {
  id: true, serial: true, litres: true, status: true, reservedUntil: true,
  productId: true, product: { select: { id: true, name: true, sku: true } },
};

// JSON response for the distributor APIs, refusing to send anything that carries an ATC secret column.
export function atcJson(body, init) {
  return NextResponse.json(assertNoAtcSecrets(jsonSafe(body)), init);
}

// Both entries of the ATC number must match; it is hashed (duplicate guard) and encrypted, never stored or logged in clear.
export function readAtcNumber(body) {
  const typed = String(body.atcNumber ?? '').trim();
  const normalized = normalizeAtcNumber(typed);
  if (!normalized) throw new ApiError('Enter the ATC number', 400);
  if (typed.length > 64) throw new ApiError('That ATC number is too long', 400);
  if (normalized !== normalizeAtcNumber(body.atcNumberConfirm)) throw new ApiError('The two ATC numbers do not match', 400);
  return { atcHash: hashAtcNumber(typed), atcCipher: encryptAtcNumber(typed) };
}
