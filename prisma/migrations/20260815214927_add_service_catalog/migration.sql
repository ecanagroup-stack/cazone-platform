-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('available', 'coming_soon', 'retired');

-- CreateTable
CREATE TABLE "ServiceCatalog" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'coming_soon',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "basePriceMonthly" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("key")
);

-- Seed the two currently-built verticals. No speculative future rows — that's the hardcoding this
-- migration is meant to stop. Add more later via /platform/services, not another migration.
INSERT INTO "ServiceCatalog" ("key", "name", "status", "sortOrder", "updatedAt") VALUES
  ('fuel_station', 'Petrol Station', 'available', 0, CURRENT_TIMESTAMP),
  ('shop', 'General Store', 'available', 1, CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_type_fkey" FOREIGN KEY ("type") REFERENCES "ServiceCatalog"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
