// Ecana Energy MongoDB -> a NEW CaZone fuel_station organization.
// Dry run: node scripts/import-ecana-fuel.mjs
// History-only apply: node scripts/import-ecana-fuel.mjs --apply --history-only
// Stock cutover/activation: node scripts/import-ecana-fuel.mjs --apply --cutover-file=PATH
// The source database is always read-only. Re-running --apply resumes by stable source IDs.
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.env.LEGACY_FUEL_APP_DIR || path.join(root, '..', 'petrol-station-app'));
dotenv.config({ path: path.join(root, '.env') });
const sourceEnv = dotenv.config({ path: path.join(sourceRoot, '.env.local') }).parsed || {};
const mongoUri = process.env.MONGODB_URI_FUEL || sourceEnv.MONGODB_URI_FUEL || sourceEnv.MONGODB_URI;
if (!mongoUri) throw new Error('Source MongoDB URI is missing');
const mongoose = createRequire(path.join(sourceRoot, 'package.json'))('mongoose');
const prisma = new PrismaClient();
// The first genuine operating shift is 4 February 2026. The owner confirmed
// that all February 2026 operating history, including later February sales,
// belongs in the import.
const cutoff = new Date('2026-02-01T00:00:00.000Z');
const apply = process.argv.includes('--apply');
const historyOnly = process.argv.includes('--history-only');
const cutoverFileArg = process.argv.find((arg) => arg.startsWith('--cutover-file='));
const cutoverFile = cutoverFileArg ? path.resolve(cutoverFileArg.slice('--cutover-file='.length)) : null;
if (apply && !cutoverFile && !historyOnly) throw new Error('Use --history-only or provide --cutover-file=PATH with signed per-tank go-live readings');
if (historyOnly && cutoverFile) throw new Error('--history-only and --cutover-file cannot be combined');
const slug = 'ecana-energy';
const id = (kind, value) => `legacy_${kind}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;
const key = (value) => value == null ? '' : String(value);
const day = (value) => new Date(value).toISOString().slice(0, 10);
const kobo = (value) => Math.round(Number(value || 0) * 100);
const valid = (value) => value != null && Number.isFinite(Number(value));
const alias = {
  // Historical station documents were removed from MongoDB. Names and operating
  // records identify their current branch; retain original IDs in the archive.
  '6a306aa5ebcd1418d8ec556f': '6a340931f62c4a56d114cd28', // Guzape
  '697ef6d85a9ad0e86a84e2fd': '6ac21594d581d5eaf2890c70', // New Nyanya
};
const dateField = {
  dayshifts: 'date', meterreadings: 'date', salesentries: 'date', paymentrecords: 'date',
  cashdeposits: 'date', tankstockentries: 'date', stockmovements: 'date',
  attendantassignments: 'assignedAt', pricehistories: 'effectiveDate', pumpopenings: 'date',
};
const setupCollections = new Set(['stations', 'users', 'attendants', 'posterminals', 'trucks', 'customers', 'products', 'productunits', 'staffs']);
const summary = {};
const chunk = (rows, size = 100) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const insert = async (model, rows) => {
  for (const batch of chunk(rows)) if (batch.length) await prisma[model].createMany({ data: batch, skipDuplicates: true });
  summary[model] = (summary[model] || 0) + rows.length;
};
const src = (doc) => key(doc?._id);
const mappedStation = (value) => alias[key(value)] || key(value);
const readDate = (name, doc) => doc[dateField[name]] || doc.createdAt || doc.date || null;
const archivePayload = (name, doc) => {
  const copy = JSON.parse(JSON.stringify(doc));
  if (name === 'users') { delete copy.password; delete copy.resetPasswordToken; delete copy.resetPasswordExpires; }
  return copy;
};

try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const collectionNames = (await db.listCollections().toArray()).map((item) => item.name).filter((name) => !name.startsWith('system.'));
  const docs = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => {
    const all = await db.collection(name).find({}).toArray();
    return [name, all.filter((doc) => {
      const at = readDate(name, doc);
      return setupCollections.has(name) || (at && new Date(at) >= cutoff);
    })];
  })));
  const stations = docs.stations || [];
  const stationById = new Map(stations.map((station) => [src(station), station]));
  const branchOf = (sourceStationId) => {
    const currentId = mappedStation(sourceStationId);
    return stationById.has(currentId) ? id('branch', currentId) : null;
  };
  const users = docs.users || [];
  const validPasswordHashes = users.filter((user) => /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(user.password || ''));
  const sourceUserIds = new Set(users.map(src));
  const owner = users.find((user) => user.role === 'admin');
  if (!owner) throw new Error('Source admin account is missing');
  const ownerId = id('user', src(owner));
  const userId = (value) => sourceUserIds.has(key(value)) ? id('user', value) : ownerId;
  const shifts = docs.dayshifts || [];
  const sourceShiftById = new Map(shifts.map((shift) => [src(shift), shift]));
  const allSales = docs.salesentries || [];
  const readings = docs.meterreadings || [];
  const capturedAt = new Date();
  const matureAt = new Date(capturedAt.getTime() - 72 * 3600000);
  const isMature = (row) => new Date(row.createdAt || row.date) <= matureAt;
  const meterByStationDayPump = new Map(readings.map((reading) => [`${reading.stationId}|${day(reading.date)}|${reading.pumpId}`, reading]));
  const saleMeter = (sale) => meterByStationDayPump.get(`${sale.stationId}|${day(sale.date)}|${sale.dispenserId}`);
  const saleFaults = (sale) => {
    const meter = saleMeter(sale);
    const litres = Number(sale.liters);
    const price = Number(sale.pricePerLiter);
    const amount = Number(sale.expectedAmount);
    const metered = Number(meter?.closing) - Number(meter?.opening) - Number(meter?.rtt || 0);
    const faults = [];
    if (!(litres > 0) || !(price > 0) || !(amount > 0) || !Number.isFinite(litres + price + amount))
      faults.push('non-positive or invalid litres, price, or amount');
    if (Number.isFinite(metered) && Math.abs(metered - litres) > 0.01)
      faults.push('meter and saved litres differ');
    if (Number.isFinite(litres * price) && Math.abs(litres * price - amount) > 1)
      faults.push('saved amount differs from litres times price');
    return faults;
  };
  const faultySales = allSales.filter((sale) => saleFaults(sale).length);
  const sales = allSales.filter((sale) => {
    const meter = saleMeter(sale);
    return !saleFaults(sale).length && (meter?.managerReviewStatus === 'approved' || (meter && isMature(meter)));
  });
  const deferredSales = allSales.filter((sale) => !sales.includes(sale));
  const sourceSaleByMeter = new Map(allSales.map((sale) => [src(saleMeter(sale)), sale]));
  const payments = docs.paymentrecords || [];
  const allDips = docs.tankstockentries || [];
  const dipsToImport = allDips.filter((dip) => dip.period === 'opening' || dip.closingStockManager != null || isMature(dip));
  const receiptMoves = (docs.stockmovements || []).filter((move) => move.movementType === 'receipt');
  const safeDeliveryAmount = (move) => [kobo(move.costPerLiter), kobo(move.totalCost)]
    .every((value) => Number.isInteger(value) && value >= 0 && value <= 2147483647);
  const oversizedDeliveries = receiptMoves.filter((move) => !safeDeliveryAmount(move));
  const shiftIds = new Set(shifts.map(src));
  const saleByShiftPump = new Map(sales.map((sale) => [`${sale.dayShiftId}|${sale.dispenserId}`, sale]));
  const matchedMeterIds = new Set(sales.map((sale) => src(meterByStationDayPump.get(`${sale.stationId}|${day(sale.date)}|${sale.dispenserId}`))).filter(Boolean));
  const unmatchedMeters = readings.filter((reading) => !matchedMeterIds.has(src(reading)) &&
    (reading.managerReviewStatus === 'approved' || isMature(reading) || sourceSaleByMeter.has(src(reading))));
  const recentUnmatchedArchivedOnly = readings.length - matchedMeterIds.size - unmatchedMeters.length;
  const paymentsByShiftPump = new Map();
  const knownPumpKeys = new Set(stations.flatMap((station) => (station.dispensers || []).map((pump) => `${src(station)}|${pump.dispenserId}`)));
  const knownTankKeys = new Set(stations.flatMap((station) => (station.tanks || []).map((tank) => `${src(station)}|${key(tank._id || tank.id)}`)));
  const historicalTanks = new Map();
  for (const dip of docs.tankstockentries || []) {
    const tankKey = `${mappedStation(dip.stationId)}|${dip.tankId}`;
    if (branchOf(dip.stationId) && !knownTankKeys.has(tankKey)) historicalTanks.set(tankKey, dip);
  }
  const shiftTankMappings = shifts.flatMap((shift) => (shift.dispenserAssignments || []).map((assignment) => ({ shift, assignment })));
  const unmappedSavedTanks = shiftTankMappings.filter(({ shift, assignment }) => assignment.tankId &&
    !knownTankKeys.has(`${mappedStation(shift.stationId)}|${assignment.tankId}`) &&
    !historicalTanks.has(`${mappedStation(shift.stationId)}|${assignment.tankId}`));
  for (const payment of payments) {
    const k = `${payment.dayShiftId}|${payment.dispenserId}`;
    paymentsByShiftPump.set(k, [...(paymentsByShiftPump.get(k) || []), payment]);
  }
  const approvedPaymentsByShiftPump = new Map([...paymentsByShiftPump].map(([k, records]) => [k,
    records.filter((payment) => payment.managerReviewStatus === 'approved' && Number(payment.totalReceived) > 0),
  ]).filter(([, records]) => records.length));
  const blockers = [];
  if (validPasswordHashes.length !== users.length) blockers.push(`${users.length - validPasswordHashes.length} source users lack compatible bcrypt password hashes`);
  if (new Set(users.map((user) => user.loginId?.trim().toLowerCase()).filter(Boolean)).size !== users.filter((user) => user.loginId?.trim()).length)
    blockers.push('Source login IDs collide after case normalization');
  if (new Set(users.map((user) => user.email?.trim().toLowerCase()).filter(Boolean)).size !== users.filter((user) => user.email?.trim()).length)
    blockers.push('Source emails collide after case normalization');
  for (const user of users) if (user.stationId && !branchOf(user.stationId)) blockers.push(`User ${src(user)} has no branch mapping`);
  for (const sale of allSales) {
    if (!shiftIds.has(key(sale.dayShiftId))) blockers.push(`Sale ${src(sale)} has no shift`);
    if (!meterByStationDayPump.has(`${sale.stationId}|${day(sale.date)}|${sale.dispenserId}`)) blockers.push(`Sale ${src(sale)} has no meter`);
    if (!branchOf(sale.stationId)) blockers.push(`Sale ${src(sale)} has no branch`);
    if (!knownPumpKeys.has(`${mappedStation(sale.stationId)}|${sale.dispenserId}`)) blockers.push(`Sale ${src(sale)} has no current pump`);
  }
  const allSaleShiftPumps = new Set(allSales.map((sale) => `${sale.dayShiftId}|${sale.dispenserId}`));
  for (const payment of payments) if (!allSaleShiftPumps.has(`${payment.dayShiftId}|${payment.dispenserId}`)) blockers.push(`Payment ${src(payment)} has no sale`);
  for (const [shiftPump] of approvedPaymentsByShiftPump) if (!saleByShiftPump.has(shiftPump))
    blockers.push(`Approved payment ${shiftPump} belongs to a deferred sale`);
  for (const shift of shifts) if (!branchOf(shift.stationId)) blockers.push(`Shift ${src(shift)} has no branch`);
  for (const shift of shifts) if (shift.status === 'in_progress') blockers.push(`Shift ${src(shift)} is still open; close it in MongoDB before cutover`);
  for (const reading of readings) if (branchOf(reading.stationId) && !knownPumpKeys.has(`${mappedStation(reading.stationId)}|${reading.pumpId}`)) blockers.push(`Meter ${src(reading)} has no current pump`);
  if (readings.length !== meterByStationDayPump.size) blockers.push('Multiple source meters share a station/date/pump key');
  const sourceSnapshot = {
    cutoff: cutoff.toISOString(), capturedAt: capturedAt.toISOString(), matureAt: matureAt.toISOString(),
    sourceCounts: Object.fromEntries(Object.entries(docs).map(([name, rows]) => [name, rows.length])),
    branchAliases: alias, salesLinkedToMeters: allSales.length - blockers.filter((entry) => entry.includes('no meter')).length,
    matureOrApprovedSalesToImport: sales.length,
    recentUnapprovedSavedSalesDeferredAsIncomplete: deferredSales.filter((sale) => !saleFaults(sale).length).length,
    faultySavedSalesDeferredAsIncomplete: faultySales.length,
    faultySavedSalesByReason: Object.fromEntries([...new Set(faultySales.flatMap(saleFaults))]
      .map((fault) => [fault, faultySales.filter((sale) => saleFaults(sale).includes(fault)).length])),
    faultySavedSaleExamples: faultySales.slice(0, 10).map((sale) => ({ sourceId: src(sale), faults: saleFaults(sale) })),
    recentUnapprovedUnmatchedMetersArchivedOnly: recentUnmatchedArchivedOnly,
    matureOrApprovedTankDipsToImport: dipsToImport.length,
    recentUnapprovedTankDipsArchivedOnly: allDips.length - dipsToImport.length,
    receiptCostsArchivedOnlyDueToIntLimit: oversizedDeliveries.map((move) => src(move)),
    loginHashesCompatible: validPasswordHashes.length,
    loginUsers: users.length,
    loginBranchMappings: users.filter((user) => user.stationId && branchOf(user.stationId)).length,
    currentBranches: stations.map((station) => ({ code: station.code, name: station.name, sourceId: src(station), targetId: branchOf(station._id) })),
    paymentRecords: payments.length,
    approvedPositivePaymentRecords: [...approvedPaymentsByShiftPump.values()].reduce((sum, records) => sum + records.length, 0),
    pendingOrZeroPaymentsArchivedOnly: payments.length - [...approvedPaymentsByShiftPump.values()].reduce((sum, records) => sum + records.length, 0),
    blockers: blockers.slice(0, 30), blockerCount: blockers.length,
    historicalTanksToKeepInactive: [...historicalTanks.keys()],
    savedShiftTankMappings: shiftTankMappings.filter(({ assignment }) => assignment.tankId).length,
    unmappedSavedShiftTanks: unmappedSavedTanks.length,
    incompleteMeterReadingsImportedWithoutSales: unmatchedMeters.length,
    targetSlug: slug, mode: apply ? historyOnly ? 'history-only-apply' : 'cutover-apply' : 'dry-run',
  };
  const requiredTanks = stations.flatMap((station) => (station.tanks || []).filter((tank) => tank.isActive !== false)
    .map((tank) => ({ stationCode: station.code, tankId: key(tank._id || tank.id), product: tank.product })));
  sourceSnapshot.requiredCutoverTanks = requiredTanks;
  const operationalDates = [
    ...shifts.map((shift) => shift.endTime || shift.startTime || shift.date),
    ...allSales.map((sale) => sale.createdAt || sale.date),
    ...(docs.stockmovements || []).map((move) => move.createdAt || move.date),
    ...(docs.tankstockentries || []).map((dip) => dip.createdAt || dip.date),
    ...(docs.cashdeposits || []).map((deposit) => deposit.createdAt || deposit.date),
  ].filter(Boolean).map((at) => new Date(at).getTime());
  const latestOperationalAt = new Date(Math.max(...operationalDates));
  sourceSnapshot.latestOperationalAt = latestOperationalAt.toISOString();
  let cutover = null;
  if (cutoverFile) {
    cutover = JSON.parse(readFileSync(cutoverFile, 'utf8'));
    if (!cutover.approvedBy || !cutover.approvedAt || !cutover.measuredAt || !Array.isArray(cutover.tanks)) {
      blockers.push('Cutover file needs approvedBy, approvedAt, measuredAt and tanks');
    } else {
      const measuredAt = new Date(cutover.measuredAt);
      const approvedAt = new Date(cutover.approvedAt);
      if (Number.isNaN(measuredAt.getTime()) || Number.isNaN(approvedAt.getTime()) || approvedAt < measuredAt)
        blockers.push('Cutover approval must be valid and after measurement');
      if (measuredAt < latestOperationalAt) blockers.push('Cutover measurement precedes a saved source operation');
      const provided = new Map(cutover.tanks.map((tank) => [`${tank.stationCode}|${tank.tankId}`, tank]));
      if (provided.size !== cutover.tanks.length || provided.size !== requiredTanks.length)
        blockers.push('Cutover tank list has duplicates or does not match the active source tanks');
      for (const tank of requiredTanks) {
        const entry = provided.get(`${tank.stationCode}|${tank.tankId}`);
        if (!entry || !Number.isFinite(Number(entry.litres)) || entry.litres === null || Number(entry.litres) < 0)
          blockers.push(`Cutover measurement missing for ${tank.stationCode}/${tank.tankId}`);
      }
    }
  }
  sourceSnapshot.cutoverFileValidated = !!cutoverFile && blockers.length === 0;
  sourceSnapshot.stockCutoverPending = !cutoverFile;
  sourceSnapshot.blockers = blockers.slice(0, 30);
  sourceSnapshot.blockerCount = blockers.length;
  if (blockers.length) throw new Error(JSON.stringify(sourceSnapshot));
  const orgExisting = await prisma.organization.findUnique({ where: { slug } });
  sourceSnapshot.targetOrganizationExists = !!orgExisting;
  const emailList = users.map((user) => user.email?.toLowerCase()).filter(Boolean);
  const usernameList = users.map((user) => user.loginId?.toLowerCase()).filter(Boolean);
  const conflicts = await prisma.user.findMany({ where: { OR: [{ email: { in: emailList } }, { username: { in: usernameList } }] }, select: { id: true, organizationId: true } });
  sourceSnapshot.identityConflicts = conflicts.filter((user) => user.organizationId !== orgExisting?.id).length;
  if (sourceSnapshot.identityConflicts) throw new Error(JSON.stringify(sourceSnapshot));
  console.log(JSON.stringify(sourceSnapshot, null, 2));
  if (!apply) process.exitCode = 0;
  else {
    // A resumed import may only write to the Ecana Energy tenant created by this script.
    const org = orgExisting || await prisma.organization.create({ data: {
      name: 'Ecana Energy', slug, currency: 'NGN', email: owner.email || null,
      subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 86400000),
    } });
    const orgId = org.id;
    const serviceId = id('service', orgId);
    await prisma.service.createMany({ data: [{ id: serviceId, organizationId: orgId, type: 'fuel_station',
      name: 'Petrol Station', isActive: false, config: { migrationStockPending: true } }], skipDuplicates: true });
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (historyOnly && service.isActive) throw new Error('History-only import cannot run against an active petrol service');
    await insert('branch', stations.map((station) => ({
      id: branchOf(station._id), organizationId: orgId, serviceId, name: station.name,
      code: station.code, address: station.location || null, isActive: station.isActive !== false,
      config: { reconciliationTolerancePct: station.tolerancePercent ?? 2.5,
        legacyStationIds: [src(station), ...Object.entries(alias).filter(([, current]) => current === src(station)).map(([old]) => old)] },
      createdAt: station.createdAt || new Date(),
    })));
    const fuelTypes = [...new Set([
      ...stations.flatMap((station) => station.availableProducts || []),
      ...sales.map((sale) => sale.fuelType),
      ...(docs.stockmovements || []).map((move) => move.fuelType),
    ].filter(Boolean))];
    const productId = (type) => id('fuelproduct', type);
    await insert('product', fuelTypes.map((type) => ({ id: productId(type), organizationId: orgId,
      serviceId, sku: type, name: type, unit: 'litre', priceRegulated: true, attributes: { legacyFuelType: type } })));
    const role = { admin: 'owner', manager: 'manager', supervisor: 'supervisor', cashier: 'cashier', daily_auditor: 'daily_auditor', external_auditor: 'external_auditor' };
    await insert('user', users.map((user) => ({ id: id('user', src(user)), organizationId: orgId,
      role: role[user.role] || 'staff', name: user.name, email: user.email?.toLowerCase() || null,
      username: user.loginId?.toLowerCase() || null, passwordHash: user.password,
      isActive: user.isActive !== false, createdAt: user.createdAt || new Date() })));
    await insert('userBranchAccess', users.filter((user) => user.stationId && branchOf(user.stationId)).map((user) => ({
      id: id('userbranch', src(user)), userId: id('user', src(user)), branchId: branchOf(user.stationId),
    })));
    const tankMap = new Map();
    const tankRows = [];
    for (const station of stations) for (const tank of station.tanks || []) {
      const sourceTankId = key(tank._id || tank.id);
      const targetId = id('tank', `${src(station)}|${sourceTankId}`);
      tankMap.set(`${src(station)}|${sourceTankId}`, targetId);
      tankRows.push({ id: targetId, organizationId: orgId, branchId: branchOf(station._id), productId: productId(tank.product),
        label: tank.label, capacity: Number(tank.capacity) || 1, isActive: tank.isActive !== false, createdAt: station.createdAt || new Date() });
    }
    for (const [tankKey, dip] of historicalTanks) {
      const currentStation = mappedStation(dip.stationId);
      const targetId = id('tank', tankKey);
      tankMap.set(tankKey, targetId);
      tankRows.push({ id: targetId, organizationId: orgId, branchId: branchOf(currentStation),
        productId: productId(dip.product), label: `${dip.tankLabel || dip.tankId} (historic)`,
        capacity: 0, isActive: false, createdAt: dip.createdAt || dip.date });
    }
    await insert('tank', tankRows);
    const pumpMap = new Map();
    const pumpRows = [];
    for (const station of stations) for (const pump of station.dispensers || []) {
      const targetId = id('pump', `${src(station)}|${pump.dispenserId}`);
      pumpMap.set(`${src(station)}|${pump.dispenserId}`, targetId);
      pumpRows.push({ id: targetId, organizationId: orgId, branchId: branchOf(station._id),
        tankId: tankMap.get(`${src(station)}|${pump.tankId}`) || null,
        label: pump.name || pump.dispenserId, isActive: pump.isActive !== false, createdAt: station.createdAt || new Date() });
    }
    await insert('dispenser', pumpRows);
    const attendantMap = new Map();
    const attendantRows = [];
    const usedStaffNumbers = new Set();
    let staffNumberCollisions = 0;
    for (const attendant of docs.attendants || []) {
      const branchId = branchOf(attendant.stationId);
      if (!branchId) continue;
      attendantMap.set(src(attendant), id('attendant', src(attendant)));
      const staffNumberKey = `${branchId}|${attendant.staffNumber}`;
      const staffNumber = usedStaffNumbers.has(staffNumberKey)
        ? `${attendant.staffNumber}-legacy-${src(attendant).slice(-8)}` : attendant.staffNumber;
      if (staffNumber !== attendant.staffNumber) staffNumberCollisions++;
      usedStaffNumbers.add(`${branchId}|${staffNumber}`);
      attendantRows.push({ id: id('attendant', src(attendant)), organizationId: orgId, branchId,
        staffNumber, name: attendant.name, phone: attendant.phone || null,
        position: attendant.position || null, employmentType: attendant.employmentType || null,
        dateOfBirth: attendant.dateOfBirth || null, gender: attendant.gender || null,
        photoUrl: attendant.photoUrl || null, employmentDate: attendant.employmentDate || null,
        isActive: attendant.isActive !== false, createdAt: attendant.createdAt || attendant.dateRegistered || new Date() });
    }
    await insert('attendant', attendantRows);
    summary.staffNumberCollisionsPreservedWithSuffix = staffNumberCollisions;
    const shiftByStationDay = new Map();
    await insert('shift', shifts.map((shift) => {
      const k = `${shift.stationId}|${day(shift.date)}`;
      shiftByStationDay.set(k, [...(shiftByStationDay.get(k) || []), shift]);
      return { id: id('shift', src(shift)), organizationId: orgId, branchId: branchOf(shift.stationId),
        openedBy: userId(shift.startedBy), status: shift.status === 'in_progress' || shift.status === 'started' ? 'open' : 'closed',
        openedAt: shift.startTime || shift.date, closedAt: shift.endTime || null,
        operatingDate: day(shift.date), shiftLabel: shift.shiftLabel || null,
        shiftOrder: shift.shiftOrder || null, totalShiftsPlanned: shift.totalShiftsPlanned || null,
        isBackfill: true, note: `Imported from MongoDB shift ${src(shift)}` };
    }));
    const assignmentRows = [];
    let archivedOnlyAssignments = 0;
    for (const assignment of docs.attendantassignments || []) {
      const candidates = shiftByStationDay.get(`${assignment.stationId}|${assignment.date}`) || [];
      const sourceShift = assignment.dayShiftId
        ? shifts.find((shift) => src(shift) === key(assignment.dayShiftId))
        : candidates.length === 1 ? candidates[0] : null;
      const targetPump = pumpMap.get(`${mappedStation(assignment.stationId)}|${assignment.dispenserId}`);
      const targetAttendant = attendantMap.get(key(assignment.attendantId));
      if (!sourceShift || !targetPump || !targetAttendant) { archivedOnlyAssignments++; continue; }
      assignmentRows.push({ id: id('assignment', src(assignment)), organizationId: orgId,
        branchId: branchOf(assignment.stationId), shiftId: id('shift', src(sourceShift)),
        dispenserId: targetPump, attendantId: targetAttendant,
        assignedBy: userId(assignment.assignedByManagerId),
        assignedAt: assignment.assignedAt || assignment.createdAt || sourceShift.date });
    }
    await insert('attendantAssignment', assignmentRows);
    summary.archivedOnlyAssignments = archivedOnlyAssignments;
    // Stable synthetic shifts hold source meters with no saved sale or shift.
    const fallbackShiftRows = [];
    for (const reading of unmatchedMeters) {
      if (sourceSaleByMeter.has(src(reading))) continue;
      const k = `${reading.stationId}|${day(reading.date)}`;
      if (branchOf(reading.stationId)) {
        const targetId = id('fallbackshift', k);
        fallbackShiftRows.push({ id: targetId, organizationId: orgId, branchId: branchOf(reading.stationId),
          openedBy: ownerId, status: 'closed', openedAt: reading.date, operatingDate: day(reading.date),
          isBackfill: true, note: 'Imported source meters without a saved sale' });
      }
    }
    await insert('shift', fallbackShiftRows);
    const pumpFor = (stationId, pumpId) => pumpMap.get(`${mappedStation(stationId)}|${pumpId}`);
    const readingRows = [];
    const saleReadingId = new Map();
    for (const sale of sales) {
      const meter = meterByStationDayPump.get(`${sale.stationId}|${day(sale.date)}|${sale.dispenserId}`);
      const sourceShift = sourceShiftById.get(key(sale.dayShiftId));
      const savedAssignment = (sourceShift?.dispenserAssignments || []).find((assignment) => assignment.dispenserId === sale.dispenserId);
      const targetPumpId = pumpFor(sale.stationId, sale.dispenserId);
      if (!targetPumpId) throw new Error(`No current pump for sale ${src(sale)} (${sale.dispenserId})`);
      const targetReadingId = id('reading', src(meter));
      saleReadingId.set(src(sale), targetReadingId);
      readingRows.push({ id: targetReadingId, organizationId: orgId, branchId: branchOf(sale.stationId),
        shiftId: id('shift', key(sale.dayShiftId)), dispenserId: targetPumpId,
        legacySourceId: src(meter), collectionCoverage: approvedPaymentsByShiftPump.has(`${sale.dayShiftId}|${sale.dispenserId}`) ? 'verified' : 'unknown',
        opening: Number(meter.opening), closing: valid(meter.closing) ? Number(meter.closing) : null,
        rtt: Number(meter.rtt || 0), litres: Number(sale.liters), expectedAmount: kobo(sale.expectedAmount),
        reviewStatus: 'approved', recordedBy: userId(meter.supervisorId), createdAt: meter.createdAt || sale.createdAt || sale.date,
        productIdAtShift: productId(sale.fuelType),
        tankIdAtShift: savedAssignment?.tankId ? tankMap.get(`${mappedStation(sale.stationId)}|${savedAssignment.tankId}`) || null : null,
        orderId: id('order', src(sale)) });
    }
    for (const meter of unmatchedMeters) {
      if (!branchOf(meter.stationId)) continue;
      const deferredSale = sourceSaleByMeter.get(src(meter));
      readingRows.push({ id: id('reading', src(meter)), organizationId: orgId, branchId: branchOf(meter.stationId),
        shiftId: deferredSale ? id('shift', key(deferredSale.dayShiftId)) : id('fallbackshift', `${meter.stationId}|${day(meter.date)}`),
        dispenserId: pumpFor(meter.stationId, meter.pumpId), legacySourceId: src(meter),
        collectionCoverage: 'unknown', opening: Number(meter.opening),
        closing: valid(meter.closing) ? Number(meter.closing) : null, rtt: Number(meter.rtt || 0),
        reviewStatus: 'pending', discrepancyNote: deferredSale
          ? `Source sale ${src(deferredSale)} deferred: ${saleFaults(deferredSale).join('; ') || 'recent unapproved meter'}`
          : 'Source meter has no saved sale',
        recordedBy: userId(meter.supervisorId), createdAt: meter.createdAt || meter.date,
        productIdAtShift: null, tankIdAtShift: null });
    }
    await insert('meterReading', readingRows.map(({ orderId, ...row }) => row));
    const orderRows = sales.map((sale) => ({ id: id('order', src(sale)), organizationId: orgId,
      branchId: branchOf(sale.stationId), orderNumber: `LEGACY-${src(sale)}`,
      subtotal: kobo(sale.expectedAmount), grandTotal: kobo(sale.expectedAmount),
      status: 'active', channel: 'fuel', createdBy: userId(sale.enteredBy), createdAt: sale.createdAt || sale.date }));
    await insert('order', orderRows);
    await insert('orderLine', sales.map((sale) => ({ id: id('orderline', src(sale)), orderId: id('order', src(sale)),
      productId: productId(sale.fuelType), qty: Number(sale.liters), unitPrice: kobo(sale.pricePerLiter), lineTotal: kobo(sale.expectedAmount) })));
    await insert('stockMove', sales.map((sale) => ({ id: id('salemove', src(sale)), organizationId: orgId,
      branchId: branchOf(sale.stationId), productId: productId(sale.fuelType), qty: -Number(sale.liters),
      reason: 'sale', ref: id('order', src(sale)), at: sale.createdAt || sale.date, userId: userId(sale.enteredBy), channel: 'fuel' })));
    for (const batch of chunk(sales, 200)) await prisma.$executeRaw(Prisma.sql`
      UPDATE "MeterReading" AS meter SET "orderId" = links."orderId"
      FROM (VALUES ${Prisma.join(batch.map((sale) => Prisma.sql`(${saleReadingId.get(src(sale))}, ${id('order', src(sale))})`))})
        AS links("id", "orderId")
      WHERE meter."id" = links."id" AND meter."organizationId" = ${orgId}
    `);
    const collectionRows = [];
    for (const [shiftPump, records] of approvedPaymentsByShiftPump) {
      const sale = saleByShiftPump.get(shiftPump);
      let paid = 0;
      for (const [index, payment] of records.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).entries()) {
        paid += kobo(payment.totalReceived);
        collectionRows.push({ id: id('collection', src(payment)), organizationId: orgId,
          branchId: branchOf(payment.stationId), shiftId: id('shift', key(payment.dayShiftId)),
          dispenserId: pumpFor(payment.stationId, payment.dispenserId), meterReadingId: saleReadingId.get(src(sale)),
          operatingDate: day(payment.date), attendantId: null, cashAmount: kobo(payment.cashReceived),
          posAmount: kobo(payment.posReceived), totalAmount: kobo(payment.totalReceived),
          posEntries: payment.posEntries || [], expectedAmount: kobo(sale.expectedAmount),
          outstandingAfter: Math.max(0, kobo(sale.expectedAmount) - paid),
          collectionType: index === 0 ? 'initial' : 'supplemental', recordedBy: userId(payment.recordedBy),
          requestId: payment.requestId || null, note: payment.notes || null, createdAt: payment.createdAt || payment.date });
      }
    }
    await insert('fuelCollection', collectionRows);
    const depositRows = (docs.cashdeposits || []).filter((deposit) => branchOf(deposit.stationId)).map((deposit) => ({
      id: id('deposit', src(deposit)), organizationId: orgId, branchId: branchOf(deposit.stationId),
      operatingDate: day(deposit.forDate || deposit.date), amount: kobo(deposit.amount),
      bankName: deposit.bankName || null, accountNumber: deposit.accountNumber || null,
      initiatedBy: userId(deposit.initiatedByCashierId), status: deposit.status || 'pending',
      approvedBy: deposit.approvedByAdminId ? userId(deposit.approvedByAdminId) : null,
      note: deposit.adminNote || deposit.rejectionReason || null, createdAt: deposit.createdAt || deposit.date,
      isBackfill: true }));
    await insert('cashDeposit', depositRows);
    const branchReceipts = receiptMoves.filter((move) => branchOf(move.stationId));
    await insert('delivery', branchReceipts.filter(safeDeliveryAmount).map((move) => ({ id: id('delivery', src(move)), organizationId: orgId,
      branchId: branchOf(move.stationId), productId: productId(move.fuelType), quantity: Number(move.quantity),
      costPerUnit: kobo(move.costPerLiter), totalCost: kobo(move.totalCost), status: 'received',
      receivedAt: move.date || move.createdAt, createdAt: move.createdAt || move.date,
      createdBy: userId(move.recordedBy), declaredLoad: valid(move.declaredLoad) ? Number(move.declaredLoad) : null,
      offloadVariance: valid(move.offloadVariance) ? Number(move.offloadVariance) : null,
      notes: move.notes || `Imported MongoDB receipt ${src(move)}`, isBackfill: true })));
    await insert('stockMove', branchReceipts.map((move) => ({ id: id('receiptmove', src(move)), organizationId: orgId,
      branchId: branchOf(move.stationId), productId: productId(move.fuelType), qty: Number(move.quantity),
      reason: 'purchase', ref: id('delivery', src(move)), at: move.date || move.createdAt,
      userId: userId(move.recordedBy), channel: 'fuel' })));
    const dipRows = [];
    let archivedOnlyDips = 0;
    for (const dip of dipsToImport) {
      const candidates = (shiftByStationDay.get(`${dip.stationId}|${day(dip.date)}`) || [])
        .sort((a, b) => new Date(a.startTime || a.date) - new Date(b.startTime || b.date));
      const sourceShift = dip.dayShiftId
        ? shifts.find((shift) => src(shift) === key(dip.dayShiftId))
        : dip.period === 'opening' ? candidates[0] : candidates.at(-1);
      const tankId = tankMap.get(`${mappedStation(dip.stationId)}|${dip.tankId}`);
      if (!sourceShift || !tankId) { archivedOnlyDips++; continue; }
      dipRows.push({ id: id('dip', src(dip)), organizationId: orgId, branchId: branchOf(dip.stationId),
        shiftId: id('shift', src(sourceShift)), tankId, operatingDate: day(dip.date),
        period: dip.period, measured: Number(dip.period === 'opening' ? dip.openingStock : dip.closingStockManager ?? dip.closingStockMeasured),
        recordedBy: userId(dip.supervisorId), createdAt: dip.createdAt || dip.date });
    }
    await insert('fuelTankDip', dipRows);
    summary.archivedOnlyDips = archivedOnlyDips;
    const priceRows = [];
    const priceHistoryRows = [];
    for (const station of stations) for (const [type, price] of Object.entries(station.currentPrices || {})) {
      if (!(Number(price) > 0)) continue;
      priceRows.push({ id: id('price', `${src(station)}|${type}`), organizationId: orgId, branchId: branchOf(station._id),
        productId: productId(type), price: kobo(price), createdBy: ownerId });
    }
    await insert('priceRule', priceRows);
    for (const history of docs.pricehistories || []) {
      if (!branchOf(history.stationId)) continue;
      priceHistoryRows.push({ id: id('pricehistory', src(history)), organizationId: orgId,
        branchId: branchOf(history.stationId), productId: productId(history.fuelType),
        oldPrice: kobo(history.previousPrice), newPrice: kobo(history.newPrice),
        reason: history.reason || null, status: history.approvalStatus || 'approved',
        changedBy: userId(history.changedBy), approvedBy: history.approvedBy ? userId(history.approvedBy) : null,
        approvedAt: history.approvedAt || null, createdAt: history.effectiveDate || history.createdAt });
    }
    await insert('priceHistory', priceHistoryRows);
    await insert('auditLog', (docs.auditlogs || []).map((log) => ({ id: id('audit', src(log)),
      organizationId: orgId, actorUserId: userId(log.userId), actorName: log.userName || 'Legacy user',
      action: `legacy.${log.action || 'event'}`, entityType: log.resource || 'Legacy', entityId: key(log.resourceId || log._id),
      after: { sourceStationId: key(log.stationId) || null, details: JSON.parse(JSON.stringify(log.details || {})) },
      createdAt: log.timestamp || log.createdAt || new Date() })));
    // Every source document remains queryable by source collection/ID. Records
    // without an unambiguous operational mapping (including audit-only stations,
    // extra meter readings and tank dips) are retained here for reconciliation.
    for (const [name, rows] of Object.entries(docs)) {
      await insert('legacyFuelRecord', rows.map((doc) => ({ organizationId: orgId,
        sourceCollection: name, sourceId: src(doc), sourceStationId: doc.stationId ? key(doc.stationId) : null,
        eventAt: readDate(name, doc) ? new Date(readDate(name, doc)) : null,
        payload: archivePayload(name, doc) })));
    }
    const measuredByStationProduct = new Map();
    for (const entry of cutover?.tanks || []) {
      const station = stations.find((item) => item.code === entry.stationCode);
      const tank = station.tanks.find((item) => key(item._id || item.id) === entry.tankId);
      const k = `${src(station)}|${tank.product}`;
      measuredByStationProduct.set(k, (measuredByStationProduct.get(k) || 0) + Number(entry.litres));
    }
    for (const [stationProduct, measured] of measuredByStationProduct) {
      const [sourceStationId, type] = stationProduct.split('|');
      const targetBranchId = branchOf(sourceStationId);
      const targetProductId = productId(type);
      const cutoverMoveId = id('cutoverstock', `${stationProduct}|${cutover.measuredAt}`);
      const ledger = await prisma.stockMove.aggregate({ where: { organizationId: orgId, branchId: targetBranchId,
        productId: targetProductId, at: { lte: new Date(cutover.measuredAt) } }, _sum: { qty: true } });
      const difference = measured - (ledger._sum.qty || 0);
      const existing = await prisma.stockMove.findUnique({ where: { id: cutoverMoveId } });
      if (existing) {
        if (Math.abs(difference) > 0.001) throw new Error(`Previously imported cutover balance has drifted for ${stationProduct}`);
      } else await prisma.stockMove.create({ data: { id: cutoverMoveId, organizationId: orgId,
        branchId: targetBranchId, productId: targetProductId, qty: difference, reason: 'stocktake',
        ref: `signed-cutover-${cutover.measuredAt}`, at: new Date(cutover.measuredAt), userId: ownerId,
        note: `Signed physical cutover stock approved by ${cutover.approvedBy} at ${cutover.approvedAt}` } });
    }
    if (cutover) await prisma.service.update({ where: { id: serviceId }, data: {
      isActive: true, config: { migrationStockPending: false, signedStockMeasuredAt: cutover.measuredAt,
        signedStockApprovedAt: cutover.approvedAt, signedStockApprovedBy: cutover.approvedBy },
    } });
    console.log(JSON.stringify({ organizationId: orgId, insertedOrAlreadyPresent: summary, archiveSourceCounts: sourceSnapshot.sourceCounts }, null, 2));
  }
} finally {
  await Promise.allSettled([mongoose.disconnect(), prisma.$disconnect()]);
}
