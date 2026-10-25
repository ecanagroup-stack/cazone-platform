import test from 'node:test';
import assert from 'node:assert/strict';
import { atcReference, salesReportRow, salesCsvRows } from '../lib/salesReportRows.mjs';

const cementLine = {
  id: 'l1', qty: 100, stockQty: 98, unitPrice: 500_000, lineTotal: 50_000_000, transportFee: 100_000, costs: [],
  sourceTruckNumber: null, sourceDriverName: null, sourceName: 'Dangote Cement PLC',
  product: { name: 'Dangote 3X', unit: 'bag', supplier: { name: 'Dangote Cement PLC' } },
  allocation: { atcNumber: '001', product: { abbreviation: 'DAN' }, vehicle: { plateNumber: 'ABC-123', driverName: 'Musa' }, supplier: { name: 'Dangote Cement PLC' } },
};
const aggregateLine = {
  id: 'l2', qty: 30, stockQty: 30, unitPrice: 1_200_000, lineTotal: 36_000_000, transportFee: 0,
  costs: [{ id: 'c1', type: 'labour', detail: 'loaders', amount: 50_000 }],
  sourceTruckNumber: 'XYZ-9', sourceDriverName: 'Ade', sourceName: 'Ishiagu Quarry', allocation: null,
  product: { name: 'Granite 3/4', unit: 'tonne', supplier: { name: 'Ishiagu Quarry' } },
};
const order = {
  id: 'o1', orderNumber: 'ORD-7', branchId: 'b1', customer: { name: 'Chika' }, saleDate: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-22T10:00:00Z'), subtotal: 86_000_000, discount: 1_000_000, transportFee: 150_000, grandTotal: 85_150_000,
  paymentMethod: 'credit', channel: 'atc', deliveryStatus: 'delivered', deliveryDate: null, deliveredAt: null, deliveryRevision: 0,
  lines: [cementLine, aggregateLine],
};
const ctx = { branchNameById: { b1: 'Main' }, deliveryEnabled: false, canEdit: () => true };

test('atcReference joins brand abbreviation and ATC number', () => {
  assert.equal(atcReference(cementLine.allocation), 'DAN-001');
  assert.equal(atcReference({ atcNumber: '5', product: {} }), '5');
  assert.equal(atcReference(null), '');
});

test('a cement line shows its ATC reference as source, even when an old row snapshotted the supplier', () => {
  const [cement, aggregate] = salesReportRow(order, ctx).lines;
  assert.equal(cement.source, 'DAN-001');
  assert.equal(aggregate.source, 'Ishiagu Quarry');
});

test('truck and driver come from the line snapshot, falling back to the ATC truck', () => {
  const [cement, aggregate] = salesReportRow(order, ctx).lines;
  assert.deepEqual([cement.truck, cement.driver], ['ABC-123', 'Musa']);
  assert.deepEqual([aggregate.truck, aggregate.driver], ['XYZ-9', 'Ade']);
});

test('report row keeps per-line quantities and the joined strings, with no quality', () => {
  const row = salesReportRow(order, ctx);
  assert.equal(row.date, '2026-10-20');
  assert.equal(row.reference, 'ORD-7');
  assert.equal(row.products, 'Dangote 3X, Granite 3/4');
  assert.equal(row.truck, 'ABC-123, XYZ-9');
  assert.equal(row.salesAmount, 85_000_000);
  assert.equal(row.quality, undefined);
  assert.deepEqual(row.lines.map((l) => [l.qty, l.stockQty, l.unitPrice, l.unit]), [[100, 98, 500_000, 'bag'], [30, 30, 1_200_000, 'tonne']]);
  assert.equal(row.edit, undefined);
});

test('shop rows carry the delivery state and edit data only while pending', () => {
  const delivered = salesReportRow(order, { ...ctx, deliveryEnabled: true });
  assert.equal(delivered.deliveryStatus, 'delivered');
  assert.equal(delivered.editable, false);
  assert.equal(delivered.edit, null);

  const pending = salesReportRow({ ...order, deliveryStatus: 'pending', deliveryRevision: 3 }, { ...ctx, deliveryEnabled: true });
  assert.equal(pending.editable, true);
  assert.equal(pending.edit.revision, 3);
  assert.equal(pending.edit.orderTransportFee, 150_000 - 100_000);
  assert.equal(pending.edit.lines[1].costs[0].amount, 50_000);

  assert.equal(salesReportRow({ ...order, deliveryStatus: 'pending' }, { ...ctx, deliveryEnabled: true, canEdit: () => false }).editable, false);
  const noPhysical = { ...order, deliveryStatus: 'pending', lines: [{ ...cementLine, stockQty: null }] };
  assert.equal(salesReportRow(noPhysical, { ...ctx, deliveryEnabled: true }).editable, false);
});

test('csv has one row per line with the order money only on the first', () => {
  const csv = salesCsvRows([salesReportRow(order, ctx)]);
  assert.equal(csv.length, 2);
  assert.deepEqual(csv.map((r) => r.product), ['Dangote 3X', 'Granite 3/4']);
  assert.deepEqual(csv.map((r) => r.unitPrice), [500_000, 1_200_000]);
  assert.deepEqual(csv.map((r) => r.total), [85_150_000, null]);
  assert.deepEqual(csv.map((r) => r.salesAmount), [85_000_000, null]);
  assert.deepEqual(csv.map((r) => r.transportAmount), [150_000, null]);
  assert.deepEqual(csv.map((r) => r.reference), ['ORD-7', 'ORD-7']);
  assert.deepEqual(csv.map((r) => [r.quantity, r.unit]), [[100, 'bag'], [30, 'tonne']]);
  assert.equal(csv.reduce((sum, r) => sum + (r.total || 0), 0), order.grandTotal);
});
