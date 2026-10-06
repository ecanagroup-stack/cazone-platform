import test from 'node:test';
import assert from 'node:assert/strict';
import { materialSaleDates, parseBusinessDate } from '../lib/saleDates.mjs';

test('late sale and delivery retain separate business dates', () => {
  const dates = materialSaleDates({ saleDate: '2026-09-28', deliveryDate: '2026-10-02', delivered: true });
  assert.equal(dates.saleDate.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(dates.deliveryDate.toISOString(), '2026-10-02T00:00:00.000Z');
});

test('pending sales have no delivery date and invalid chronology is rejected', () => {
  assert.equal(materialSaleDates({ saleDate: '2026-10-02', delivered: false }).deliveryDate, null);
  assert.throws(() => materialSaleDates({ saleDate: '2026-10-02', deliveryDate: '2026-10-01', delivered: true }), /before sale date/);
  assert.throws(() => parseBusinessDate('2026-02-30', 'Sale date'), /valid date/);
});
