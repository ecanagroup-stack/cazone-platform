import test from 'node:test';
import assert from 'node:assert/strict';
import { orgHasCustomers, orgHasOrdering, orgHasAtc, hasActiveDistributorAddon } from '../lib/customerAccess.mjs';

const now = new Date('2026-10-25T12:00:00Z');
const active = { type: 'distributor', status: 'active', endsAt: null };

test('shops and general stores always have customers', () => {
  assert.equal(orgHasCustomers({ businessType: 'shop', addons: [], now }), true);
  assert.equal(orgHasCustomers({ businessType: 'general_store', now }), true);
});

test('a fuel station has customers only with an active distributor add-on', () => {
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', addons: [], now }), false);
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', now }), false);
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', addons: [active], now }), true);
});

test('canceled, expired and other-type add-ons do not count', () => {
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', addons: [{ ...active, status: 'canceled' }], now }), false);
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', addons: [{ ...active, endsAt: new Date('2026-10-01') }], now }), false);
  assert.equal(orgHasCustomers({ businessType: 'fuel_station', addons: [{ type: 'petrol_station', status: 'active', endsAt: null }], now }), false);
  assert.equal(hasActiveDistributorAddon([{ ...active, endsAt: new Date('2026-11-01') }], now), true);
});

test('unknown or missing business types have no customers', () => {
  assert.equal(orgHasCustomers({ businessType: null, addons: [active], now }), false);
  assert.equal(orgHasCustomers({ businessType: 'pharmacy', addons: [active], now }), false);
});

test('only shop and general_store order goods', () => {
  assert.equal(orgHasOrdering({ businessType: 'shop' }), true);
  assert.equal(orgHasOrdering({ businessType: 'general_store' }), true);
  assert.equal(orgHasOrdering({ businessType: 'fuel_station' }), false);
});

test('ATC ordering needs a fuel station with an active distributor add-on', () => {
  assert.equal(orgHasAtc({ businessType: 'fuel_station', addons: [active], now }), true);
  assert.equal(orgHasAtc({ businessType: 'fuel_station', addons: [], now }), false);
  assert.equal(orgHasAtc({ businessType: 'fuel_station', addons: [{ ...active, endsAt: new Date('2026-10-01') }], now }), false);
  assert.equal(orgHasAtc({ businessType: 'shop', addons: [active], now }), false);
});
