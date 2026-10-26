import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoAtcNumber, hasAtcNumberLeak, normalizeAtcNumber } from '../lib/atcNumber.js';

test('the number is normalised so retyping with different case or spacing matches', () => {
  assert.equal(normalizeAtcNumber('  ab 123 x '), 'AB123X');
  assert.equal(normalizeAtcNumber('ab123x'), normalizeAtcNumber('AB 123 X'));
  assert.equal(normalizeAtcNumber(null), '');
});

test('the leak guard flags the number column anywhere in a response', () => {
  assert.equal(hasAtcNumberLeak({ serial: '100001', litres: 33000 }), false);
  assert.equal(hasAtcNumberLeak({ data: [{ serial: '100001', vehicle: { plateNumber: 'X' } }] }), false);
  assert.equal(hasAtcNumberLeak({ atcNumber: 'AB123' }), true);
  assert.equal(hasAtcNumberLeak({ data: [{ nested: { atcNumber: 'AB123' } }] }), true);
  assert.equal(hasAtcNumberLeak({ at: new Date() }), false);
  assert.throws(() => assertNoAtcNumber({ data: [{ atcNumber: 'AB123' }] }), /ATC number/);
});
