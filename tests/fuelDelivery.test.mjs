import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFuelOffload, offloadVariance, reallocateOffload, canOffloadFuel, canViewFuelDeliveries } from '../lib/fuelDelivery.mjs';

const branchTanks = [
  { id: 't1', label: 'Tank 1', productId: 'pms' },
  { id: 't2', label: 'Tank 2', productId: 'pms' },
  { id: 't3', label: 'Tank 3', productId: 'ago' },
];
const base = { productId: 'pms', branchTanks };

test('actual litres are closing minus opening, summed across tanks, and a short load is a shortage', () => {
  const result = computeFuelOffload({
    ...base, declaredLoad: 33000,
    tanks: [{ tankId: 't1', openingDip: 1200, closingDip: 18700 }, { tankId: 't2', openingDip: 500, closingDip: 14950 }],
  });
  assert.equal(result.actual, 31950);
  assert.equal(result.variance, -1050);
  assert.equal(result.shortage, 1050);
  assert.equal(result.excess, 0);
  assert.deepEqual(result.tanks.map((t) => [t.tankId, t.offloaded]), [['t1', 17500], ['t2', 14450]]);
});

test('an exact match has no shortage or excess, and an over-delivery is an excess', () => {
  const exact = computeFuelOffload({ ...base, declaredLoad: 10000, actualLitres: 10000, tankId: 't1' });
  assert.deepEqual([exact.variance, exact.shortage, exact.excess], [0, 0, 0]);
  const over = computeFuelOffload({ ...base, declaredLoad: 10000, actualLitres: 10040.5 });
  assert.deepEqual([over.variance, over.shortage, over.excess], [40.5, 0, 40.5]);
});

test('a typed actual works without dips, with or without a named tank', () => {
  const withTank = computeFuelOffload({ ...base, declaredLoad: 9000, actualLitres: '8900', tankId: 't2' });
  assert.equal(withTank.actual, 8900);
  assert.deepEqual(withTank.tanks, [{ tankId: 't2', tankLabel: 'Tank 2', openingDip: null, closingDip: null, offloaded: 8900 }]);
  assert.deepEqual(computeFuelOffload({ ...base, declaredLoad: 9000, actualLitres: 8900 }).tanks, []);
});

test('litres add up in millilitres, free of float noise', () => {
  const result = computeFuelOffload({
    ...base, declaredLoad: 0.3,
    tanks: [{ tankId: 't1', openingDip: 0.1, closingDip: 0.2 }, { tankId: 't2', openingDip: 0.1, closingDip: 0.3 }],
  });
  assert.equal(result.actual, 0.3);
  assert.equal(result.variance, 0);
  assert.equal(offloadVariance(1000.3, 1000.1).variance, 0.2);
});

test('dips that disagree with a typed figure are rejected, matching ones are accepted', () => {
  const tanks = [{ tankId: 't1', openingDip: 100, closingDip: 600 }];
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks, actualLitres: 450 }), /do not match/);
  assert.equal(computeFuelOffload({ ...base, declaredLoad: 500, tanks, actualLitres: 500 }).actual, 500);
});

test('rejects bad declared load, bad dips, wrong product or tank, and an empty offload', () => {
  const dips = [{ tankId: 't1', openingDip: 100, closingDip: 600 }];
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: '', tanks: dips }), /Declared load/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 0, tanks: dips }), /positive/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500 }), /dips or the actual/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 't1', openingDip: 600, closingDip: 100 }] }), /lower than opening/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 't1', openingDip: 100, closingDip: 100 }] }), /zero/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 't1', openingDip: '', closingDip: 100 }] }), /opening dip/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 't3', openingDip: 0, closingDip: 500 }] }), /does not hold/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 'other', openingDip: 0, closingDip: 500 }] }), /does not belong/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, tanks: [{ tankId: 't1', openingDip: 0, closingDip: 200 }, { tankId: 't1', openingDip: 200, closingDip: 500 }] }), /more than once/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, actualLitres: 0 }), /positive/);
  assert.throws(() => computeFuelOffload({ ...base, declaredLoad: 500, actualLitres: -5 }), /Actual litres/);
});

test('a corrected quantity on a single tank moves its closing dip with it', () => {
  const rows = [{ tankId: 't1', openingDip: 1200, closingDip: 18700, offloaded: 17500 }];
  assert.deepEqual(reallocateOffload(rows, 17000), [{ tankId: 't1', openingDip: 1200, closingDip: 18200, offloaded: 17000 }]);
  assert.deepEqual(reallocateOffload([{ tankId: 't1', openingDip: null, closingDip: null, offloaded: 900 }], 800),
    [{ tankId: 't1', openingDip: null, closingDip: null, offloaded: 800 }]);
  assert.deepEqual(reallocateOffload([], 800), []);
});

test('a multi-tank correction needs a per-tank split that adds up to the new total', () => {
  const rows = [
    { tankId: 't1', openingDip: 100, closingDip: 600, offloaded: 500 },
    { tankId: 't2', openingDip: 0, closingDip: 300, offloaded: 300 },
  ];
  assert.throws(() => reallocateOffload(rows, 700), /each tank/);
  assert.throws(() => reallocateOffload(rows, 700, [{ tankId: 't1', offloaded: 400 }, { tankId: 't2', offloaded: 200 }]), /add up/);
  assert.throws(() => reallocateOffload(rows, 700, [{ tankId: 't1', offloaded: 400 }, { tankId: 'x', offloaded: 300 }]), /do not match/);
  const fixed = reallocateOffload(rows, 700, [{ tankId: 't1', offloaded: 400 }, { tankId: 't2', offloaded: 300 }]);
  assert.deepEqual(fixed.map((r) => [r.tankId, r.offloaded, r.closingDip]), [['t1', 400, 500], ['t2', 300, 300]]);
});

test('only owner and manager record a fuel offload; auditors may read the history, plain staff neither', () => {
  assert.ok(canOffloadFuel('owner') && canOffloadFuel('manager'));
  for (const role of ['staff', 'materials_manager', 'atc_manager', 'supervisor', 'cashier', 'auditor']) assert.equal(canOffloadFuel(role), false, role);
  assert.ok(canViewFuelDeliveries('auditor') && canViewFuelDeliveries('manager'));
  for (const role of ['staff', 'cashier', 'supervisor']) assert.equal(canViewFuelDeliveries(role), false, role);
});
