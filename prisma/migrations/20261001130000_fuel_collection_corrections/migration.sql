ALTER TABLE "FuelCollection" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedBy" TEXT,
ADD COLUMN "voidReason" TEXT;
