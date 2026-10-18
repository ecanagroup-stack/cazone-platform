CREATE TYPE "BusinessAddonType" AS ENUM ('shop', 'petrol_station', 'distributor');

CREATE TYPE "BusinessAddonStatus" AS ENUM ('active', 'canceled');

ALTER TABLE "ProvisioningRequest"
ADD COLUMN "addonType" "BusinessAddonType";

ALTER TABLE "Branch"
ADD COLUMN "addonType" "BusinessAddonType";

CREATE TABLE "BusinessAddon" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "BusinessAddonType" NOT NULL,
    "status" "BusinessAddonStatus" NOT NULL DEFAULT 'active',
    "branchId" TEXT,
    "price" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAddon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessAddon_branchId_key" ON "BusinessAddon"("branchId");
CREATE INDEX "BusinessAddon_organizationId_type_status_idx"
ON "BusinessAddon"("organizationId", "type", "status");

ALTER TABLE "BusinessAddon"
ADD CONSTRAINT "BusinessAddon_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessAddon"
ADD CONSTRAINT "BusinessAddon_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
