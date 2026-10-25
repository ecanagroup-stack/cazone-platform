import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATC_FUEL_TYPES, atcSku, atcTotalKobo, displayStatus, formatSerial, holdUntil, HOLD_MINUTES, isAtcProduct, isHoldLapsed,
  isSellable, parseLitres, pricePerLitreKobo, sellableWhere, atcPaystackReference, classifyAtcPayment,
} from '../lib/petroleumAtc.mjs';

const now = new Date('2026-10-25T12:00:00Z');

test('serials are zero-padded', () => {
  assert.equal(formatSerial(1), 'ATC-000001');
  assert.equal(formatSerial(123), 'ATC-000123');
  assert.equal(formatSerial(1234567), 'ATC-1234567');
});

test('litres must be a positive whole number within the truck capacity', () => {
  assert.equal(parseLitres('33000', 33000), 33000);
  assert.equal(parseLitres(1000, null), 1000);
  assert.equal(parseLitres(' 45000 ', undefined), 45000);
  for (const bad of ['', '0', '-5', '12.5', 'abc', null, 1.5, NaN]) assert.throws(() => parseLitres(bad, 33000), /whole number/);
  assert.throws(() => parseLitres(33001, 33000), /33,000 litres/);
});

test('totals are exact kobo and reject unsafe integers', () => {
  assert.equal(atcTotalKobo(33000, 85000), 2_805_000_000);
  assert.throws(() => atcTotalKobo(0, 85000));
  assert.throws(() => atcTotalKobo(100, 0));
  assert.throws(() => atcTotalKobo(100, 1.5));
  assert.throws(() => atcTotalKobo(Number.MAX_SAFE_INTEGER, 2), /too large/);
});

test('price per litre converts naira to kobo by rounding the product', () => {
  assert.equal(pricePerLitreKobo('850'), 85000);
  assert.equal(pricePerLitreKobo('850.555'), 85056);
  for (const bad of ['', '0', '-1', 'x', null]) assert.throws(() => pricePerLitreKobo(bad), /valid price/);
});

test('an expired hold is sellable, a live hold is not', () => {
  const live = { status: 'reserved', reservedUntil: new Date(now.getTime() + 60_000) };
  const lapsed = { status: 'reserved', reservedUntil: new Date(now.getTime() - 1) };
  assert.equal(isSellable({ status: 'available' }, now), true);
  assert.equal(isSellable(live, now), false);
  assert.equal(isSellable(lapsed, now), true);
  assert.equal(isHoldLapsed(lapsed, now), true);
  assert.equal(isHoldLapsed(live, now), false);
  for (const status of ['sold', 'delivered', 'cancelled']) assert.equal(isSellable({ status, reservedUntil: null }, now), false);
});

test('a lapsed hold reads as available to clients', () => {
  assert.equal(displayStatus({ status: 'reserved', reservedUntil: new Date(now.getTime() - 1) }, now), 'available');
  assert.equal(displayStatus({ status: 'reserved', reservedUntil: new Date(now.getTime() + 1) }, now), 'reserved');
  assert.equal(displayStatus({ status: 'sold' }, now), 'sold');
});

test('the sellable where fragment mirrors isSellable', () => {
  assert.deepEqual(sellableWhere(now), { OR: [{ status: 'available' }, { status: 'reserved', reservedUntil: { lte: now } }] });
});

test('holds last HOLD_MINUTES', () => {
  assert.equal(holdUntil(now).getTime() - now.getTime(), HOLD_MINUTES * 60_000);
  assert.equal(HOLD_MINUTES, 15);
});

test('only channel=atc products are ATC products', () => {
  assert.equal(isAtcProduct({ attributes: { channel: 'atc' } }), true);
  assert.equal(isAtcProduct({ attributes: {} }), false);
  assert.equal(isAtcProduct({ attributes: null }), false);
  assert.equal(isAtcProduct(null), false);
  assert.deepEqual(ATC_FUEL_TYPES.map((t) => atcSku(t.code)), ['ATC-PMS', 'ATC-AGO', 'ATC-DPK']);
});

test('a paid charge is classified against the ATC its reference was issued for', () => {
  const held = { status: 'reserved', reservedByCustomerId: 'c1', paystackReference: 'ref1', totalPrice: 1_000_000 };
  assert.equal(classifyAtcPayment(held, { reference: 'ref1', paidKobo: 1_000_000 }), 'apply');
  assert.equal(classifyAtcPayment(held, { reference: 'ref1', paidKobo: 1_200_000 }), 'apply');
  assert.equal(classifyAtcPayment(held, { reference: 'ref1', paidKobo: 999_999 }), 'underpaid');
  // A lapsed hold nobody else claimed still stands: the row is still reserved for this reference.
  assert.equal(classifyAtcPayment({ ...held, reservedUntil: new Date(0) }, { reference: 'ref1', paidKobo: 1_000_000 }), 'apply');
  assert.equal(classifyAtcPayment({ ...held, status: 'sold' }, { reference: 'ref1', paidKobo: 1_000_000 }), 'already_applied');
  assert.equal(classifyAtcPayment({ ...held, status: 'delivered' }, { reference: 'ref1', paidKobo: 1_000_000 }), 'already_applied');
});

test('a charge whose ATC went elsewhere is a conflict, never a sale', () => {
  const held = { status: 'reserved', reservedByCustomerId: 'c1', paystackReference: 'ref1', totalPrice: 1_000_000 };
  assert.equal(classifyAtcPayment(null, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment({ ...held, paystackReference: 'ref2' }, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment({ ...held, status: 'cancelled' }, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment({ ...held, status: 'available' }, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment({ ...held, reservedByCustomerId: null }, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment({ ...held, totalPrice: null }, { reference: 'ref1', paidKobo: 1_000_000 }), 'conflict');
  assert.equal(classifyAtcPayment(held, { reference: '', paidKobo: 1_000_000 }), 'conflict');
});

test('references carry the ATC id and are unique per attempt', () => {
  assert.equal(atcPaystackReference('abc', new Date(1000)), 'atc_abc_1000');
  assert.notEqual(atcPaystackReference('abc', new Date(1000)), atcPaystackReference('abc', new Date(1001)));
});
