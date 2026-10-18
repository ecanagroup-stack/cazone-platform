-- Widen monetary storage sitewide. These conversions preserve every existing value and
-- remove PostgreSQL's signed 32-bit ceiling for prices, balances, and accumulated totals.
ALTER TABLE "ServiceCatalog" ALTER COLUMN "basePriceMonthly" TYPE BIGINT USING "basePriceMonthly"::BIGINT;

ALTER TABLE "Organization"
  ALTER COLUMN "monthlyPrice" TYPE BIGINT USING "monthlyPrice"::BIGINT,
  ALTER COLUMN "paystackPlanAmount" TYPE BIGINT USING "paystackPlanAmount"::BIGINT;

ALTER TABLE "ProvisioningRequest" ALTER COLUMN "quotedAmount" TYPE BIGINT USING "quotedAmount"::BIGINT;
ALTER TABLE "BusinessAddon" ALTER COLUMN "price" TYPE BIGINT USING "price"::BIGINT;

ALTER TABLE "Customer"
  ALTER COLUMN "creditLimit" TYPE BIGINT USING "creditLimit"::BIGINT,
  ALTER COLUMN "transportRate" TYPE BIGINT USING "transportRate"::BIGINT,
  ALTER COLUMN "balance" TYPE BIGINT USING "balance"::BIGINT;

ALTER TABLE "CustomerAdjustment"
  ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT,
  ALTER COLUMN "balanceBefore" TYPE BIGINT USING "balanceBefore"::BIGINT,
  ALTER COLUMN "balanceAfter" TYPE BIGINT USING "balanceAfter"::BIGINT;

ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT;
ALTER TABLE "PaymentAllocation" ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT;
ALTER TABLE "PriceRule" ALTER COLUMN "price" TYPE BIGINT USING "price"::BIGINT;
ALTER TABLE "PriceHistory"
  ALTER COLUMN "oldPrice" TYPE BIGINT USING "oldPrice"::BIGINT,
  ALTER COLUMN "newPrice" TYPE BIGINT USING "newPrice"::BIGINT;

ALTER TABLE "Order"
  ALTER COLUMN "subtotal" TYPE BIGINT USING "subtotal"::BIGINT,
  ALTER COLUMN "discount" TYPE BIGINT USING "discount"::BIGINT,
  ALTER COLUMN "transportFee" TYPE BIGINT USING "transportFee"::BIGINT,
  ALTER COLUMN "labourFee" TYPE BIGINT USING "labourFee"::BIGINT,
  ALTER COLUMN "otherFee" TYPE BIGINT USING "otherFee"::BIGINT,
  ALTER COLUMN "grandTotal" TYPE BIGINT USING "grandTotal"::BIGINT;

ALTER TABLE "OrderLine"
  ALTER COLUMN "unitPrice" TYPE BIGINT USING "unitPrice"::BIGINT,
  ALTER COLUMN "managerUnitPrice" TYPE BIGINT USING "managerUnitPrice"::BIGINT,
  ALTER COLUMN "lineTotal" TYPE BIGINT USING "lineTotal"::BIGINT,
  ALTER COLUMN "transportFee" TYPE BIGINT USING "transportFee"::BIGINT;

ALTER TABLE "OrderLineCost" ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT;
ALTER TABLE "Delivery" ALTER COLUMN "costPerUnit" TYPE BIGINT USING "costPerUnit"::BIGINT;

ALTER TABLE "Shift"
  ALTER COLUMN "openingFloat" TYPE BIGINT USING "openingFloat"::BIGINT,
  ALTER COLUMN "countedCash" TYPE BIGINT USING "countedCash"::BIGINT,
  ALTER COLUMN "countedFloat" TYPE BIGINT USING "countedFloat"::BIGINT,
  ALTER COLUMN "expectedCash" TYPE BIGINT USING "expectedCash"::BIGINT,
  ALTER COLUMN "difference" TYPE BIGINT USING "difference"::BIGINT;

ALTER TABLE "CashDeposit" ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT;

ALTER TABLE "MeterReading"
  ALTER COLUMN "expectedAmount" TYPE BIGINT USING "expectedAmount"::BIGINT,
  ALTER COLUMN "cashCollected" TYPE BIGINT USING "cashCollected"::BIGINT;

ALTER TABLE "PosPayment" ALTER COLUMN "amount" TYPE BIGINT USING "amount"::BIGINT;

ALTER TABLE "FuelCollection"
  ALTER COLUMN "cashAmount" TYPE BIGINT USING "cashAmount"::BIGINT,
  ALTER COLUMN "posAmount" TYPE BIGINT USING "posAmount"::BIGINT,
  ALTER COLUMN "totalAmount" TYPE BIGINT USING "totalAmount"::BIGINT,
  ALTER COLUMN "expectedAmount" TYPE BIGINT USING "expectedAmount"::BIGINT,
  ALTER COLUMN "outstandingAfter" TYPE BIGINT USING "outstandingAfter"::BIGINT;
