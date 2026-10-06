ALTER TABLE "Order"
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'delivered',
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveredBy" TEXT,
  ADD COLUMN "deliveryRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderLine" ADD COLUMN "stockQty" DOUBLE PRECISION;

ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryStatus_check" CHECK ("deliveryStatus" IN ('pending', 'delivered'));
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryRevision_check" CHECK ("deliveryRevision" >= 0);
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_stockQty_check" CHECK ("stockQty" IS NULL OR "stockQty" > 0);
