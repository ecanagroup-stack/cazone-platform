-- Petroleum distributor ATCs (the `distributor` add-on of a fuel station). Money is BIGINT kobo.
-- "atcHash" (keyed HMAC) and "atcCipher" (AES-256-GCM) hold the real ATC number; neither is ever
-- returned by an API. "serial" is the in-house id customers and sales staff see.
CREATE TABLE "PetroleumAtc" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "litres" INTEGER NOT NULL,
    "atcHash" TEXT NOT NULL,
    "atcCipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "reservedByCustomerId" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "paystackReference" TEXT,
    "unitPrice" BIGINT,
    "totalPrice" BIGINT,
    "priceRuleId" TEXT,
    "customerId" TEXT,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "soldBy" TEXT,
    "soldAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "truckPlate" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PetroleumAtc_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PetroleumAtc_paystackReference_key" ON "PetroleumAtc"("paystackReference");
CREATE UNIQUE INDEX "PetroleumAtc_organizationId_serial_key" ON "PetroleumAtc"("organizationId", "serial");
CREATE UNIQUE INDEX "PetroleumAtc_organizationId_atcHash_key" ON "PetroleumAtc"("organizationId", "atcHash");
CREATE INDEX "PetroleumAtc_organizationId_status_idx" ON "PetroleumAtc"("organizationId", "status");
CREATE INDEX "PetroleumAtc_vehicleId_idx" ON "PetroleumAtc"("vehicleId");
CREATE INDEX "PetroleumAtc_customerId_idx" ON "PetroleumAtc"("customerId");

-- A truck carries one open ATC at a time. Prisma cannot express a partial unique index, so this is
-- SQL-only (like the CHECK constraints below).
CREATE UNIQUE INDEX "PetroleumAtc_vehicleId_open_key" ON "PetroleumAtc"("vehicleId") WHERE "status" IN ('available', 'reserved', 'sold');

ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_litres_check" CHECK ("litres" > 0);
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_status_check" CHECK ("status" IN ('available', 'reserved', 'sold', 'delivered', 'cancelled'));
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_money_check" CHECK (("unitPrice" IS NULL OR "unitPrice" >= 0) AND ("totalPrice" IS NULL OR "totalPrice" >= 0));
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_sold_check" CHECK ("status" NOT IN ('sold', 'delivered') OR "totalPrice" IS NOT NULL);

ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PetroleumAtc" ADD CONSTRAINT "PetroleumAtc_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
