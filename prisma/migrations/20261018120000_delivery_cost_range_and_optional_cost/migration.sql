-- Keep delivery costs in minor units, but allow receipts large enough to exceed a 32-bit integer.
ALTER TABLE "Delivery"
  ALTER COLUMN "costPerUnit" DROP NOT NULL,
  ALTER COLUMN "totalCost" DROP NOT NULL,
  ALTER COLUMN "totalCost" TYPE DOUBLE PRECISION;
