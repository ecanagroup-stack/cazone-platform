// Read-only preflight for importing Ecana Energy's MongoDB history from February 2026.
// Run from cazone-platform: node scripts/preflight-ecana-fuel.mjs
// LEGACY_FUEL_APP_DIR may point at a different petrol-station-app checkout.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.env.LEGACY_FUEL_APP_DIR || path.join(root, '..', 'petrol-station-app'));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const sourceEnv = dotenv.config({ path: path.join(sourceRoot, '.env.local'), quiet: true }).parsed || {};
const mongoUri = process.env.MONGODB_URI_FUEL || sourceEnv.MONGODB_URI_FUEL || sourceEnv.MONGODB_URI;
if (!mongoUri) throw new Error('MongoDB connection setting is missing from the source checkout');
const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
const mongoose = sourceRequire('mongoose');
const prisma = new PrismaClient();
const cutoff = new Date('2026-02-01T00:00:00.000Z');
const collections = {
  dayshifts: 'date', meterreadings: 'date', salesentries: 'date', paymentrecords: 'date',
  cashdeposits: 'date', tankstockentries: 'date', stockmovements: 'date',
  attendantassignments: 'assignedAt', pricehistories: 'effectiveDate',
  pumpopenings: 'date', flags: 'date', auditlogs: 'createdAt',
};

try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const stations = await db.collection('stations').find({}, { projection: { _id: 1, code: 1, name: 1, tanks: 1, dispensers: 1 } }).toArray();
  const stationIds = new Set(stations.map((station) => String(station._id)));
  const sourceUsers = await db.collection('users').find({}, { projection: { email: 1, loginId: 1, role: 1 } }).toArray();
  const report = {
    cutoff: cutoff.toISOString(),
    sourceStations: stations.map((station) => ({ id: String(station._id), code: station.code, name: station.name,
      tanks: station.tanks?.length || 0, pumps: station.dispensers?.length || 0 })),
    sourceUsers: sourceUsers.length,
    targetOrganizationExists: false,
    identityConflicts: [],
    collections: {},
    orphanStationIds: [],
    unknownCollectionPolicy: 'No PaymentRecord means unknown, never an inferred attendant debt',
  };
  const target = await prisma.organization.findFirst({ where: { OR: [{ slug: 'ecana-energy' }, { name: { equals: 'Ecana Energy', mode: 'insensitive' } }] }, select: { id: true } });
  report.targetOrganizationExists = !!target;
  const emails = sourceUsers.map((user) => user.email?.toLowerCase()).filter(Boolean);
  const usernames = sourceUsers.map((user) => user.loginId?.toLowerCase()).filter(Boolean);
  const conflicts = await prisma.user.findMany({ where: { OR: [{ email: { in: emails } }, { username: { in: usernames } }] }, select: { id: true, email: true, username: true, organizationId: true } });
  report.identityConflicts = conflicts.map((user) => ({ email: user.email, username: user.username, sameTargetOrganization: user.organizationId === target?.id }));
  const orphanIds = new Set();
  for (const [name, dateField] of Object.entries(collections)) {
    const docs = await db.collection(name).find({ [dateField]: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, [dateField]: 1 } }).toArray();
    const older = await db.collection(name).countDocuments({ [dateField]: { $lt: cutoff } });
    const undated = await db.collection(name).countDocuments({ [dateField]: { $exists: false } });
    const dates = docs.map((doc) => doc[dateField]).filter(Boolean).sort((a, b) => a - b);
    report.collections[name] = { fromCutoff: docs.length, beforeCutoff: older, undated,
      first: dates[0]?.toISOString() || null, last: dates.at(-1)?.toISOString() || null };
    for (const doc of docs) if (doc.stationId && !stationIds.has(String(doc.stationId))) orphanIds.add(String(doc.stationId));
  }
  report.orphanStationIds = [...orphanIds].sort();
  const [shifts, sales, readings, payments, dips] = await Promise.all([
    db.collection('dayshifts').find({ date: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, stationName: 1, date: 1 } }).toArray(),
    db.collection('salesentries').find({ date: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, dayShiftId: 1, dispenserId: 1, date: 1 } }).toArray(),
    db.collection('meterreadings').find({ date: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, pumpId: 1, date: 1 } }).toArray(),
    db.collection('paymentrecords').find({ date: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, dayShiftId: 1, dispenserId: 1, date: 1 } }).toArray(),
    db.collection('tankstockentries').find({ date: { $gte: cutoff } }, { projection: { _id: 1, stationId: 1, tankId: 1, period: 1, date: 1 } }).toArray(),
  ]);
  const shiftIds = new Set(shifts.map((shift) => String(shift._id)));
  const saleKeys = new Set(sales.map((sale) => `${sale.stationId}|${sale.date.toISOString().slice(0, 10)}|${sale.dispenserId}`));
  const readingKeys = new Set(readings.map((reading) => `${reading.stationId}|${reading.date.toISOString().slice(0, 10)}|${reading.pumpId}`));
  const shiftPumpKeys = new Set(sales.map((sale) => `${sale.dayShiftId}|${sale.dispenserId}`));
  report.linkage = {
    salesWithoutShift: sales.filter((sale) => !shiftIds.has(String(sale.dayShiftId))).length,
    salesWithoutMatchingMeter: sales.filter((sale) => !readingKeys.has(`${sale.stationId}|${sale.date.toISOString().slice(0, 10)}|${sale.dispenserId}`)).length,
    metersWithoutMatchingSale: readings.filter((reading) => !saleKeys.has(`${reading.stationId}|${reading.date.toISOString().slice(0, 10)}|${reading.pumpId}`)).length,
    paymentsWithoutMatchingSale: payments.filter((payment) => !shiftPumpKeys.has(`${payment.dayShiftId}|${payment.dispenserId}`)).length,
    duplicateSalesPerShiftPump: sales.length - shiftPumpKeys.size,
    duplicateSalesPerStationDatePump: sales.length - saleKeys.size,
    duplicateMetersPerStationDatePump: readings.length - readingKeys.size,
    duplicateDipsPerStationDateTankPeriod: dips.length - new Set(dips.map((dip) => `${dip.stationId}|${dip.date.toISOString().slice(0, 10)}|${dip.tankId}|${dip.period}`)).size,
  };
  const saleCount = report.collections.salesentries.fromCutoff;
  const paymentCount = report.collections.paymentrecords.fromCutoff;
  report.collectionCoverage = { salesEntries: saleCount, savedPaymentRecords: paymentCount,
    note: 'Record counts are not a one-to-one match; every pump requires linkage checks before import.' };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.allSettled([mongoose.disconnect(), prisma.$disconnect()]);
}
