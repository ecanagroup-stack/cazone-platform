// Pure rules for a fuel tanker offload — petrol-station-app's Truck Offload (api/stations/[id]/stock).
// Litres are summed in whole millilitres so several tanks never drift by float noise; the stored and
// returned figures are litres. `declared` is the depot waybill, `actual` what really went into the
// tanks, and variance = actual - declared (negative = shortage, positive = excess). Stock moves by the
// actual litres, never the declared load.

const toMl = (value, label) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) || number < 0) throw new Error(`${label} must be a number of litres, zero or more`);
  return Math.round(number * 1000);
};
const toLitres = (ml) => ml / 1000;

// Who may record or correct a tanker offload at a fuel branch (the old app's stock route: Admin and Manager), and who
// may read the history. stock.receive is held by plain staff too, so the fuel branch checks these roles instead.
const FUEL_OFFLOAD_ROLES = ['owner', 'manager', 'super_admin'];
const FUEL_DELIVERY_VIEW_ROLES = [...FUEL_OFFLOAD_ROLES, 'auditor', 'daily_auditor', 'external_auditor'];
export const canOffloadFuel = (role) => FUEL_OFFLOAD_ROLES.includes(role);
export const canViewFuelDeliveries = (role) => FUEL_DELIVERY_VIEW_ROLES.includes(role);

// The tankers a fuel branch can offload from: registered as a tanker, or already used for a fuel delivery
// (same rule as the Fuel > Trucks list). A Prisma `where` for Vehicle.
export const FUEL_VEHICLE_WHERE = { isActive: true, OR: [{ type: 'tanker' }, { deliveries: { some: { branch: { service: { type: 'fuel_station' } } } } }] };

// variance = actual - declared, split into the shortage / excess the reports quote (both >= 0).
export function offloadVariance(actual, declared) {
  const ml = toMl(actual, 'Actual litres') - toMl(declared, 'Declared load');
  const variance = toLitres(ml);
  return { variance, shortage: ml < 0 ? -variance : 0, excess: ml > 0 ? variance : 0 };
}

// A delivery with its figures spelled out the way the fuel screens quote them: `quantity` is the ACTUAL
// litres received, `declaredLoad` the waybill, and the variance is split into shortage / excess litres.
// A plain receipt with no declared load has no variance, never a zero-shortage claim.
export function withOffloadFigures(delivery) {
  const { variance, shortage, excess } = delivery.declaredLoad == null
    ? { variance: null, shortage: 0, excess: 0 }
    : offloadVariance(delivery.quantity, delivery.declaredLoad);
  return { ...delivery, actualLitres: delivery.quantity, offloadVariance: variance, shortage, excess };
}

// The actual litres of one offload, from either per-tank dipsticks or one typed figure.
//   declaredLoad  litres on the waybill (required, > 0)
//   productId     the delivery's product — every receiving tank must hold it
//   branchTanks   [{ id, label, productId }] the branch's tanks
//   tanks         [{ tankId, openingDip, closingDip }] — offloaded per tank = closing - opening
//   actualLitres  typed total, used when there are no dips; `tankId` optionally names the one tank
// With dips AND a typed figure the two must agree. Returns the figures to store.
export function computeFuelOffload({ declaredLoad, productId, branchTanks = [], tanks, actualLitres, tankId }) {
  const declaredMl = toMl(declaredLoad, 'Declared load');
  if (declaredMl <= 0) throw new Error('Declared load must be positive (take it from the depot waybill)');

  const byId = new Map(branchTanks.map((tank) => [tank.id, tank]));
  const checkTank = (id) => {
    const tank = byId.get(id);
    if (!tank) throw new Error('Tank does not belong to this branch');
    if (tank.productId !== productId) throw new Error(`${tank.label} does not hold the selected product`);
    return tank;
  };

  const hasDips = Array.isArray(tanks) && tanks.length > 0;
  const hasTyped = actualLitres !== '' && actualLitres != null;
  if (!hasDips && !hasTyped) throw new Error('Enter the tank dips or the actual litres discharged');

  let rows = [];
  let actualMl;
  if (hasDips) {
    const seen = new Set();
    for (const entry of tanks) {
      const tank = checkTank(entry.tankId);
      if (seen.has(tank.id)) throw new Error(`${tank.label} is listed more than once`);
      seen.add(tank.id);
      const opening = toMl(entry.openingDip, `${tank.label} opening dip`);
      const closing = toMl(entry.closingDip, `${tank.label} closing dip`);
      if (closing < opening) throw new Error(`${tank.label}: closing dip is lower than opening dip - check your readings`);
      rows.push({ tankId: tank.id, tankLabel: tank.label, openingDip: toLitres(opening), closingDip: toLitres(closing), offloaded: toLitres(closing - opening), ml: closing - opening });
    }
    actualMl = rows.reduce((sum, row) => sum + row.ml, 0);
    if (hasTyped && toMl(actualLitres, 'Actual litres') !== actualMl) throw new Error('The actual litres typed do not match the dip readings');
  } else {
    actualMl = toMl(actualLitres, 'Actual litres');
    if (tankId) {
      const tank = checkTank(tankId);
      rows = [{ tankId: tank.id, tankLabel: tank.label, openingDip: null, closingDip: null, offloaded: toLitres(actualMl), ml: actualMl }];
    }
  }
  if (actualMl <= 0) throw new Error(hasDips ? 'Total offloaded is zero - enter the closing dip readings' : 'Actual litres discharged must be positive');

  const { variance, shortage, excess } = offloadVariance(toLitres(actualMl), toLitres(declaredMl));
  return {
    declaredLoad: toLitres(declaredMl),
    actual: toLitres(actualMl),
    variance, shortage, excess,
    tanks: rows.map(({ ml, ...row }) => row),
  };
}

// A corrected actual for a delivery that already has per-tank rows. One tank takes the whole new figure
// (and its closing dip moves with it, so closing - opening still equals what was offloaded); a
// multi-tank offload needs the new split in `perTank` ([{ tankId, offloaded }]) summing to the new total.
export function reallocateOffload(rows, newActual, perTank) {
  const totalMl = toMl(newActual, 'Quantity');
  if (!rows.length) return [];
  let split;
  if (rows.length === 1) {
    split = new Map([[rows[0].tankId, totalMl]]);
  } else {
    if (!Array.isArray(perTank) || perTank.length !== rows.length) throw new Error('This delivery went into several tanks - give the corrected litres for each tank');
    split = new Map();
    for (const entry of perTank) {
      if (!rows.some((row) => row.tankId === entry.tankId) || split.has(entry.tankId)) throw new Error('The per-tank litres do not match the tanks on this delivery');
      split.set(entry.tankId, toMl(entry.offloaded, 'Tank litres'));
    }
    if ([...split.values()].reduce((sum, ml) => sum + ml, 0) !== totalMl) throw new Error('The per-tank litres must add up to the corrected quantity');
  }
  return rows.map((row) => {
    const offloaded = toLitres(split.get(row.tankId));
    return { ...row, offloaded, closingDip: row.openingDip == null ? null : toLitres(toMl(row.openingDip, 'Opening dip') + split.get(row.tankId)) };
  });
}

// One historical (backfill) delivery — petrol-station-app's backfill "Tank Deliveries" step. The receiving
// tank and the ACTUAL litres received are required; the declared load (waybill) is optional because paper
// records often lack it. Without one there is no variance at all (null), never a made-up zero shortage.
export function computeBackfillDelivery({ productId, tankId, declaredLoad, actualLitres, branchTanks = [] }) {
  if (!tankId) throw new Error('Choose the receiving tank');
  const tank = branchTanks.find((item) => item.id === tankId);
  if (!tank) throw new Error('Tank does not belong to this branch');
  if (tank.productId !== productId) throw new Error(`${tank.label} does not hold the selected product`);

  if (actualLitres === '' || actualLitres == null) throw new Error('Enter the actual litres received');
  const actualMl = toMl(actualLitres, 'Actual litres');
  if (actualMl <= 0) throw new Error('Actual litres received must be positive');
  const actual = toLitres(actualMl);

  if (declaredLoad === '' || declaredLoad == null) {
    return { declaredLoad: null, actual, variance: null, shortage: 0, excess: 0, tank: { tankId: tank.id, tankLabel: tank.label, openingDip: null, closingDip: null, offloaded: actual } };
  }
  const declaredMl = toMl(declaredLoad, 'Declared load');
  if (declaredMl <= 0) throw new Error('Declared load must be positive, or leave it blank if the waybill is not to hand');
  const { variance, shortage, excess } = offloadVariance(actual, toLitres(declaredMl));
  return { declaredLoad: toLitres(declaredMl), actual, variance, shortage, excess, tank: { tankId: tank.id, tankLabel: tank.label, openingDip: null, closingDip: null, offloaded: actual } };
}
