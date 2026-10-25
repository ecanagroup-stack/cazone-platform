import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRangeWhere, effectiveDate, lagosDayRange } from '../lib/businessDates.mjs';

test('effectiveDate prefers the business date and otherwise reads createdAt as a Lagos day', () => {
  assert.equal(effectiveDate({ saleDate: new Date('2026-09-28T00:00:00Z'), createdAt: new Date('2026-10-02T09:00:00Z') }, 'saleDate'), '2026-09-28');
  assert.equal(effectiveDate({ saleDate: '2026-09-28T00:00:00.000Z', createdAt: '2026-10-02T09:00:00Z' }, 'saleDate'), '2026-09-28');
  assert.equal(effectiveDate({ saleDate: null, createdAt: new Date('2026-10-01T23:30:00Z') }, 'saleDate'), '2026-10-02');
});

test('dateRangeWhere matches the business date or, when null, the Lagos createdAt day', () => {
  const { AND: [{ OR }] } = dateRangeWhere('saleDate', { from: '2026-10-01', to: '2026-10-02' });
  assert.equal(OR[0].saleDate.gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(OR[0].saleDate.lte.toISOString(), '2026-10-02T23:59:59.999Z');
  assert.equal(OR[1].saleDate, null);
  assert.equal(OR[1].createdAt.gte.toISOString(), '2026-09-30T23:00:00.000Z');
  assert.equal(OR[1].createdAt.lte.toISOString(), '2026-10-02T22:59:59.999Z');
});

test('dateRangeWhere does not use a top-level OR, so it can sit beside a caller\'s own', () => {
  assert.equal(dateRangeWhere('saleDate', { from: '2026-10-01' }).OR, undefined);
});

test('dateRangeWhere supports open ends and no range', () => {
  assert.deepEqual(dateRangeWhere('paymentDate', {}), {});
  const { AND: [{ OR }] } = dateRangeWhere('paymentDate', { to: '2026-10-02' });
  assert.equal(OR[0].paymentDate.gte, undefined);
  assert.throws(() => dateRangeWhere('paymentDate', { from: 'nonsense' }), /valid date/);
});

test('lagosDayRange gives the instant bounds of the Lagos days', () => {
  const range = lagosDayRange({ from: '2026-10-01', to: '2026-10-02' });
  assert.equal(range.gte.toISOString(), '2026-09-30T23:00:00.000Z');
  assert.equal(range.lte.toISOString(), '2026-10-02T22:59:59.999Z');
  assert.deepEqual(lagosDayRange({}), {});
  assert.throws(() => lagosDayRange({ to: '2026-13-01' }), /valid date/);
});
