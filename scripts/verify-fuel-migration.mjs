import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const [shifts, datedShifts, previousPayments, collections, mismatchedCollections] = await Promise.all([
    prisma.shift.count(),
    prisma.shift.count({ where: { operatingDate: { not: null } } }),
    prisma.meterReading.count({ where: { paymentRecordedAt: { not: null } } }),
    prisma.fuelCollection.count(),
    prisma.fuelCollection.count({ where: { totalAmount: { lte: 0 } } }),
  ]);
  console.log(JSON.stringify({ shifts, datedShifts, previousPayments, collections, nonPositiveCollections: mismatchedCollections }));
  if (shifts !== datedShifts || previousPayments > collections || mismatchedCollections > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
