-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN "reviewedBy" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "litres" DOUBLE PRECISION,
ADD COLUMN "expectedAmount" INTEGER,
ADD COLUMN "cashCollected" INTEGER,
ADD COLUMN "paymentRecordedBy" TEXT,
ADD COLUMN "paymentRecordedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PosTerminal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "terminalId" TEXT,
    "provider" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meterReadingId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosTerminal_organizationId_idx" ON "PosTerminal"("organizationId");
CREATE INDEX "PosTerminal_branchId_idx" ON "PosTerminal"("branchId");
CREATE INDEX "PosPayment_organizationId_idx" ON "PosPayment"("organizationId");
CREATE INDEX "PosPayment_meterReadingId_idx" ON "PosPayment"("meterReadingId");

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_meterReadingId_fkey" FOREIGN KEY ("meterReadingId") REFERENCES "MeterReading"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
