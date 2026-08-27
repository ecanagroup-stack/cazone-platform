-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "labourFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otherFee" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "transportFee" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderLineCost" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLineCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLineCost_orderLineId_idx" ON "OrderLineCost"("orderLineId");

-- AddForeignKey
ALTER TABLE "OrderLineCost" ADD CONSTRAINT "OrderLineCost_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
