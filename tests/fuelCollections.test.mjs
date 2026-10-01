import test from 'node:test';
import assert from 'node:assert/strict';
import { operatingDateAt, overdueShiftBlockers, summarizePumpCollection, summarizeTankProduct, validateCollectionInput } from '../lib/fuelCollections.mjs';

test('each selling pump keeps its own shortfall despite another pump overpaying', () => {
  const pumpA = summarizePumpCollection(10000, [{ cashAmount: 3000, posAmount: 2000 }]);
  const pumpB = summarizePumpCollection(8000, [{ cashAmount: 11000, posAmount: 0 }]);
  assert.equal(pumpA.outstanding, 5000);
  assert.equal(pumpB.overage, 3000);
  assert.equal(pumpA.outstanding + pumpB.outstanding, 5000);
});

test('later settlement reduces only the previously short pump balance', () => {
  const before = summarizePumpCollection(10000, [{ cashAmount: 3000, posAmount: 2000 }]);
  const after = summarizePumpCollection(10000, [
    { cashAmount: 3000, posAmount: 2000 }, { cashAmount: 4000, posAmount: 1000 },
  ]);
  assert.equal(before.outstanding, 5000);
  assert.equal(after.outstanding, 0);
});

test('an owner correction keeps the old handover in history without counting it', () => {
  const totals = summarizePumpCollection(10000, [
    { cashAmount: 3000, posAmount: 0, voidedAt: new Date() },
    { cashAmount: 4000, posAmount: 1000, voidedAt: null },
  ]);
  assert.equal(totals.collected, 5000);
  assert.equal(totals.outstanding, 5000);
});

test('an overnight shift retains its Lagos operating date', () => {
  assert.equal(operatingDateAt(new Date('2026-10-01T23:30:00Z')), '2026-10-02');
  assert.equal(operatingDateAt(new Date('2026-10-01T22:30:00Z')), '2026-10-01');
});

test('zero and malformed handovers cannot satisfy an initial collection', () => {
  assert.throws(() => validateCollectionInput(0, []), /greater than zero/);
  assert.throws(() => validateCollectionInput(0, [{ terminalId: 't1', amount: 12.5 }]), /kobo/);
  assert.deepEqual(validateCollectionInput(100, [{ terminalId: 't1', amount: 200 }]),
    { cashAmount: 100, posAmount: 200, totalAmount: 300 });
});

test('the noon job leaves a shift open until every physical tank and selling pump is complete', () => {
  const readings = [{ id: 'r1', closing: 50, reviewStatus: 'approved', litres: 20 }];
  const tanks = [{ id: 't1' }, { id: 't2' }];
  const collections = [{ meterReadingId: 'r1', collectionType: 'initial', totalAmount: 1000 }];
  assert.deepEqual(overdueShiftBlockers(readings, tanks, [{ tankId: 't1' }], collections), ['closing tank stock missing']);
  assert.deepEqual(overdueShiftBlockers(readings, tanks, [{ tankId: 't1' }, { tankId: 't2' }], collections), []);
  assert.match(overdueShiftBlockers(readings, tanks, [{ tankId: 't1' }, { tankId: 't2' }], [])[0], /collection/);
});

test('two tanks of one product reconcile against their combined opening and closing dips', () => {
  const tanks = [{ id: 't1', productId: 'pms' }, { id: 't2', productId: 'pms' }];
  const opening = [{ tankId: 't1', measured: 1000 }, { tankId: 't2', measured: 500 }];
  const closing = [{ tankId: 't1', measured: 900 }, { tankId: 't2', measured: 450 }];
  const readings = [{ dispenser: { tank: { productId: 'pms' } }, opening: 100, closing: 260, rtt: 10 }];
  assert.deepEqual(summarizeTankProduct('pms', tanks, opening, closing, readings, [], 0),
    { opening: 1500, receipts: 0, sales: 150, book: 1350, measured: 1350 });
});
