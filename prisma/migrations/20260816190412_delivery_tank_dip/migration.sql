-- Fuel tanker delivery dip verification (D6)
ALTER TABLE "Delivery" ADD COLUMN "tankId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "declaredLoad" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN "openingDip" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN "closingDip" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN "offloadVariance" DOUBLE PRECISION;

ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
