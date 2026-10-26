-- Fuel delivery core: per-trip driver snapshot, the shift a tanker was offloaded in, and a per-tank
-- split of each offload (one tanker can discharge into several tanks). All additive: the new Delivery
-- columns are nullable, so existing rows are untouched, and Delivery.tankId/openingDip/closingDip keep
-- holding the first tank's figures.
ALTER TABLE "Delivery" ADD COLUMN "driverName" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "driverPhone" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "Delivery_shiftId_idx" ON "Delivery"("shiftId");
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DeliveryTank" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "openingDip" DOUBLE PRECISION,
    "closingDip" DOUBLE PRECISION,
    "offloaded" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryTank_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryTank_organizationId_idx" ON "DeliveryTank"("organizationId");
CREATE INDEX "DeliveryTank_deliveryId_idx" ON "DeliveryTank"("deliveryId");
CREATE INDEX "DeliveryTank_tankId_idx" ON "DeliveryTank"("tankId");

ALTER TABLE "DeliveryTank" ADD CONSTRAINT "DeliveryTank_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryTank" ADD CONSTRAINT "DeliveryTank_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryTank" ADD CONSTRAINT "DeliveryTank_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dip-verified offloads recorded before this table existed keep their single tank as one row.
INSERT INTO "DeliveryTank" ("id", "organizationId", "deliveryId", "tankId", "openingDip", "closingDip", "offloaded")
SELECT gen_random_uuid()::text, "organizationId", "id", "tankId", "openingDip", "closingDip", "quantity"
FROM "Delivery" WHERE "tankId" IS NOT NULL;
