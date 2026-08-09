-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_orderId_key" ON "MeterReading"("orderId");
