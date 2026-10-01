ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'daily_auditor';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'external_auditor';

ALTER TABLE "Shift" ADD COLUMN "operatingDate" TEXT;
ALTER TABLE "CashDeposit" ADD COLUMN "operatingDate" TEXT;
UPDATE "Shift" SET "operatingDate" = to_char("openedAt" AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD');
UPDATE "CashDeposit" d SET "operatingDate" = s."operatingDate" FROM "Shift" s WHERE d."shiftId" = s."id";
CREATE INDEX "Shift_branchId_operatingDate_idx" ON "Shift"("branchId", "operatingDate");

CREATE TABLE "FuelCollection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "meterReadingId" TEXT NOT NULL,
  "dispenserId" TEXT NOT NULL,
  "attendantId" TEXT,
  "operatingDate" TEXT NOT NULL,
  "cashAmount" INTEGER NOT NULL,
  "posAmount" INTEGER NOT NULL,
  "totalAmount" INTEGER NOT NULL,
  "posEntries" JSONB NOT NULL,
  "expectedAmount" INTEGER NOT NULL,
  "outstandingAfter" INTEGER NOT NULL,
  "collectionType" TEXT NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "requestId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelCollection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FuelCollection_organizationId_requestId_key" ON "FuelCollection"("organizationId", "requestId");
CREATE INDEX "FuelCollection_organizationId_shiftId_dispenserId_idx" ON "FuelCollection"("organizationId", "shiftId", "dispenserId");
CREATE INDEX "FuelCollection_branchId_operatingDate_idx" ON "FuelCollection"("branchId", "operatingDate");
CREATE INDEX "FuelCollection_meterReadingId_createdAt_idx" ON "FuelCollection"("meterReadingId", "createdAt");
ALTER TABLE "FuelCollection" ADD CONSTRAINT "FuelCollection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelCollection" ADD CONSTRAINT "FuelCollection_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelCollection" ADD CONSTRAINT "FuelCollection_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelCollection" ADD CONSTRAINT "FuelCollection_meterReadingId_fkey" FOREIGN KEY ("meterReadingId") REFERENCES "MeterReading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve collections already entered through the earlier one-payment-per-reading UI.
INSERT INTO "FuelCollection" (
  "id", "organizationId", "branchId", "shiftId", "meterReadingId", "dispenserId",
  "attendantId", "operatingDate", "cashAmount", "posAmount", "totalAmount",
  "posEntries", "expectedAmount", "outstandingAfter", "collectionType", "recordedBy", "createdAt"
)
SELECT
  gen_random_uuid()::text, r."organizationId", r."branchId", r."shiftId", r."id", r."dispenserId",
  (SELECT a."attendantId" FROM "AttendantAssignment" a
    WHERE a."shiftId" = r."shiftId" AND a."dispenserId" = r."dispenserId"
    ORDER BY a."assignedAt" DESC LIMIT 1),
  s."operatingDate", COALESCE(r."cashCollected", 0),
  COALESCE((SELECT SUM(p."amount")::integer FROM "PosPayment" p WHERE p."meterReadingId" = r."id"), 0),
  COALESCE(r."cashCollected", 0) + COALESCE((SELECT SUM(p."amount")::integer FROM "PosPayment" p WHERE p."meterReadingId" = r."id"), 0),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('terminalId', p."terminalId", 'amount', p."amount"))
    FROM "PosPayment" p WHERE p."meterReadingId" = r."id"), '[]'::jsonb),
  COALESCE(r."expectedAmount", 0),
  GREATEST(0, COALESCE(r."expectedAmount", 0) - COALESCE(r."cashCollected", 0)
    - COALESCE((SELECT SUM(p."amount")::integer FROM "PosPayment" p WHERE p."meterReadingId" = r."id"), 0)),
  'initial', COALESCE(r."paymentRecordedBy", r."recordedBy", s."openedBy"),
  COALESCE(r."paymentRecordedAt", r."createdAt")
FROM "MeterReading" r JOIN "Shift" s ON s."id" = r."shiftId"
WHERE r."paymentRecordedAt" IS NOT NULL
  AND (COALESCE(r."cashCollected", 0) + COALESCE((SELECT SUM(p."amount") FROM "PosPayment" p WHERE p."meterReadingId" = r."id"), 0)) > 0;
