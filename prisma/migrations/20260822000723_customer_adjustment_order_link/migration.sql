-- AlterTable
ALTER TABLE "CustomerAdjustment" ADD COLUMN     "method" TEXT,
ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "CustomerAdjustment_orderId_idx" ON "CustomerAdjustment"("orderId");

-- AddForeignKey
ALTER TABLE "CustomerAdjustment" ADD CONSTRAINT "CustomerAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
