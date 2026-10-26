import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryBookTotals } from '../lib/summaryBookTotals.mjs';

const row = (product, productId, fields) => ({ product, productId, stockIn: 0, sales: 0, totalAmount: 0, tolerance: 0, shortage: 0, ...fields });

test('totals add stock in, sales, revenue, tolerance and shortage across every shift and product', () => {
  const { overall } = summaryBookTotals([
    row('PMS', 'p1', { stockIn: 33000, sales: 1200.5, totalAmount: 120050000, tolerance: 6.003, shortage: 5000 }),
    row('PMS', 'p1', { stockIn: 0, sales: 800.25, totalAmount: 80025000, tolerance: 4.001 }),
    row('AGO', 'p2', { stockIn: 20000, sales: 500, totalAmount: 60000000, tolerance: 2.5, shortage: 1000 }),
  ]);
  assert.deepEqual(overall, { stockIn: 53000, sales: 2500.75, revenue: 260075000, tolerance: 12.504, shortage: 6000 });
});

test('totals are also given per product, sorted by name', () => {
  const { byProduct } = summaryBookTotals([
    row('PMS', 'p1', { stockIn: 100, sales: 10, totalAmount: 1000, tolerance: 0.05 }),
    row('AGO', 'p2', { stockIn: 50, sales: 5, totalAmount: 600, tolerance: 0.025 }),
    row('PMS', 'p1', { stockIn: 25, sales: 2, totalAmount: 200, tolerance: 0.01 }),
  ]);
  assert.deepEqual(byProduct.map((p) => [p.product, p.stockIn, p.sales, p.revenue, p.tolerance]),
    [['AGO', 50, 5, 600, 0.025], ['PMS', 125, 12, 1200, 0.06]]);
});

test('the unconfirmed-readings row and an empty range add nothing', () => {
  const unconfirmed = row('Unconfirmed pump readings', null, { stockIn: 999, sales: 999, totalAmount: 999 });
  assert.deepEqual(summaryBookTotals([unconfirmed]).overall, { stockIn: 0, sales: 0, revenue: 0, tolerance: 0, shortage: 0 });
  assert.deepEqual(summaryBookTotals([]).byProduct, []);
});

test('float noise is rounded away from litre totals', () => {
  const { overall } = summaryBookTotals([
    row('PMS', 'p1', { sales: 0.1, tolerance: 0.1 }), row('PMS', 'p1', { sales: 0.2, tolerance: 0.2 }),
  ]);
  assert.equal(overall.sales, 0.3);
  assert.equal(overall.tolerance, 0.3);
});
