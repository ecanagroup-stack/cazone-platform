-- M1: dedicated Cement Brands / Stonedust pages (ecana_shop-app port)
ALTER TABLE "Product" ADD COLUMN "abbreviation" TEXT;
ALTER TABLE "Product" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
