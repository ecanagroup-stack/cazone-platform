-- Delivery totals are stored in minor currency units (kobo/cents). A standard PostgreSQL INTEGER
-- tops out at about 2.147 billion minor units, which is too small for high-volume fuel receipts.
ALTER TABLE "Delivery"
  ALTER COLUMN "costPerUnit" DROP NOT NULL,
  ALTER COLUMN "totalCost" DROP NOT NULL,
  ALTER COLUMN "totalCost" TYPE BIGINT USING "totalCost"::BIGINT;
