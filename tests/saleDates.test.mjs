import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotFuture, businessToday, isBackdated, materialSaleDates, optionalBusinessDate, parseBusinessDate } from '../lib/saleDates.mjs';

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

test('businessToday follows Lagos, not UTC', () => {
  assert.equal(businessToday(new Date('2026-10-01T23:30:00Z')), '2026-10-02');
  assert.equal(businessToday(new Date('2026-10-01T22:59:00Z')), '2026-10-01');
});

test('future sale and delivery dates are rejected, today is fine', () => {
  const now = new Date('2026-10-01T23:30:00Z'); // 00:30 on the 2nd in Lagos
  assert.equal(materialSaleDates({ saleDate: '2026-10-02', delivered: false }, now).saleDate.toISOString(), '2026-10-02T00:00:00.000Z');
  assert.throws(() => materialSaleDates({ saleDate: '2026-10-03', delivered: false }, now), /Sale date cannot be in the future/);
  assert.throws(() => materialSaleDates({ saleDate: '2026-10-02', deliveryDate: '2026-10-03', delivered: true }, now), /Delivery date cannot be in the future/);
  assert.throws(() => assertNotFuture('2026-10-03', 'Payment date', now), /Payment date cannot be in the future/);
});

test('isBackdated is true only for days before the Lagos day', () => {
  const now = new Date('2026-10-01T23:30:00Z');
  assert.equal(isBackdated('2026-10-02', now), false);
  assert.equal(isBackdated('2026-10-01', now), true);
  assert.equal(isBackdated(parseBusinessDate('2026-09-30', 'Date'), now), true);
  assert.throws(() => isBackdated('2026-10-25x', now), /valid date/);
});

test('optionalBusinessDate leaves a blank date null and still blocks the future', () => {
  const now = new Date('2026-10-01T23:30:00Z');
  assert.equal(optionalBusinessDate('', 'Payment date', now), null);
  assert.equal(optionalBusinessDate(undefined, 'Payment date', now), null);
  assert.equal(optionalBusinessDate('2026-09-30', 'Payment date', now).toISOString(), '2026-09-30T00:00:00.000Z');
  assert.throws(() => optionalBusinessDate('2026-10-03', 'Payment date', now), /Payment date cannot be in the future/);
  assert.throws(() => optionalBusinessDate('yesterday', 'Payment date', now), /valid date/);
});
