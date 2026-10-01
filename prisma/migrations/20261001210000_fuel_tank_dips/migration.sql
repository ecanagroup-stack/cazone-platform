CREATE TABLE "FuelTankDip" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "tankId" TEXT NOT NULL,
  "operatingDate" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "measured" DOUBLE PRECISION NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelTankDip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FuelTankDip_shiftId_tankId_period_key" ON "FuelTankDip"("shiftId", "tankId", "period");
CREATE INDEX "FuelTankDip_organizationId_branchId_operatingDate_idx" ON "FuelTankDip"("organizationId", "branchId", "operatingDate");
ALTER TABLE "FuelTankDip" ADD CONSTRAINT "FuelTankDip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelTankDip" ADD CONSTRAINT "FuelTankDip_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelTankDip" ADD CONSTRAINT "FuelTankDip_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuelTankDip" ADD CONSTRAINT "FuelTankDip_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
