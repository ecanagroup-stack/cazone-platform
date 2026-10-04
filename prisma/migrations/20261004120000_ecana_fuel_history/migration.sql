ALTER TABLE "PriceRule" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PriceHistory" ADD COLUMN "branchId" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN "collectionCoverage" TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE "MeterReading" ADD COLUMN "legacySourceId" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN "tankIdAtShift" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN "productIdAtShift" TEXT;

CREATE INDEX "PriceRule_branchId_productId_validTo_idx" ON "PriceRule"("branchId", "productId", "validTo");
CREATE INDEX "PriceHistory_branchId_productId_createdAt_idx" ON "PriceHistory"("branchId", "productId", "createdAt");
CREATE UNIQUE INDEX "MeterReading_legacySourceId_key" ON "MeterReading"("legacySourceId");

CREATE TABLE "LegacyFuelRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceCollection" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceStationId" TEXT,
    "eventAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegacyFuelRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegacyFuelRecord_organizationId_sourceCollection_sourceId_key" ON "LegacyFuelRecord"("organizationId", "sourceCollection", "sourceId");
CREATE INDEX "LegacyFuelRecord_organizationId_sourceCollection_eventAt_idx" ON "LegacyFuelRecord"("organizationId", "sourceCollection", "eventAt");
CREATE INDEX "LegacyFuelRecord_organizationId_sourceStationId_idx" ON "LegacyFuelRecord"("organizationId", "sourceStationId");
ALTER TABLE "LegacyFuelRecord" ADD CONSTRAINT "LegacyFuelRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
