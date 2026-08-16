-- M3: dedicated Cement Sale flow — transport fee, added on top of subtotal
ALTER TABLE "Order" ADD COLUMN "transportFee" INTEGER NOT NULL DEFAULT 0;
