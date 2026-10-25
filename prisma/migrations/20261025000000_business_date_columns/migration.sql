-- Business dates: the date a transaction actually happened, which may be back-dated, separate from
-- the recorded-at createdAt. All nullable; readers fall back to createdAt when null.
-- "Order"."saleDate" was added by 20261006220000_material_sale_dates and CustomerAdjustment.saleDate
-- was only ever in schema.prisma, so IF NOT EXISTS keeps this safe wherever either already exists.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "saleDate" TIMESTAMP(3);
ALTER TABLE "CustomerAdjustment" ADD COLUMN IF NOT EXISTS "saleDate" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentDate" TIMESTAMP(3);
ALTER TABLE "CashDeposit" ADD COLUMN IF NOT EXISTS "depositDate" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "businessDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_organizationId_saleDate_idx" ON "Order"("organizationId", "saleDate");
CREATE INDEX IF NOT EXISTS "Payment_customerId_paymentDate_idx" ON "Payment"("customerId", "paymentDate");
