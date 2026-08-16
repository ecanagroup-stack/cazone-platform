-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "allocationId" TEXT;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
