-- M2: ATC workflow (ecana_shop-app port) — Delivery already generalizes the ATC lifecycle, just needs
-- the ATC's own tracking number and notes.
ALTER TABLE "Delivery" ADD COLUMN "atcNumber" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "notes" TEXT;
