import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents } from '../lib/money.mjs';

test('keeps the kobo part of a naira amount', () => {
  assert.equal(toCents(1500.75), 150075);
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents(0.5), 50);
});

test('whole naira and blank values convert as before', () => {
  assert.equal(toCents(2000), 200000);
  assert.equal(toCents(''), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents('abc'), 0);
});

test('rejects amounts that cannot be stored safely', () => {
  assert.throws(() => toCents(1e18), /too large/);
});
