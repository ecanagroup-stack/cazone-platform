import test from 'node:test';
import assert from 'node:assert/strict';
import { revisedSaleTotals, allocationReleasePlan, revisedAtcAvailability } from '../lib/pendingSaleEdit.mjs';

test('revised invoice uses billed value and line charges independently of physical stock', () => {
  const lines = [
    { lineTotal: 120_000, transportFee: 5_000, costs: [{ type: 'labour', amount: 2_000 }] },
    { lineTotal: 80_000, transportFee: 3_000, costs: [{ type: 'other', amount: 1_000 }] },
  ];
  assert.deepEqual(revisedSaleTotals(lines, 10_000, 4_000), {
    subtotal: 200_000, transportFee: 12_000, labourFee: 2_000, otherFee: 1_000, grandTotal: 205_000,
  });
});

test('lowering a paid invoice releases newest allocations without changing payment amounts', () => {
  const allocations = [{ id: 'newer', amount: 4_000 }, { id: 'older', amount: 7_000 }];
  assert.deepEqual(allocationReleasePlan(allocations, 8_000), [{ id: 'newer', amount: 1_000 }]);
  assert.deepEqual(allocationReleasePlan(allocations, 2_000), [
    { id: 'newer', amount: 0 }, { id: 'older', amount: 2_000 },
  ]);
  assert.deepEqual(allocationReleasePlan(allocations, 12_000), []);
  assert.deepEqual(allocations, [{ id: 'newer', amount: 4_000 }, { id: 'older', amount: 7_000 }]);
});

test('physical correction closes or reopens an ATC and never overdraws it', () => {
  assert.deepEqual(revisedAtcAvailability({ quantity: 10, qtyRemaining: 3, status: 'arrived' }, 3), { remaining: 0, status: 'closed' });
  assert.deepEqual(revisedAtcAvailability({ quantity: 10, qtyRemaining: 0, status: 'closed', arrivalDate: new Date() }, -2), { remaining: 2, status: 'arrived' });
  assert.throws(() => revisedAtcAvailability({ quantity: 10, qtyRemaining: 3, status: 'loaded' }, 4), /Only 3 remain/);
  assert.throws(() => revisedAtcAvailability({ quantity: 10, qtyRemaining: 0, status: 'closed' }, 1), /no longer available/);
});
