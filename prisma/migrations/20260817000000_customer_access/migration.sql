-- Part B: customers become branch/business-bound
CREATE TABLE "CustomerAccess" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerAccess_customerId_branchId_key" ON "CustomerAccess"("customerId", "branchId");
CREATE INDEX "CustomerAccess_branchId_idx" ON "CustomerAccess"("branchId");

ALTER TABLE "CustomerAccess" ADD CONSTRAINT "CustomerAccess_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAccess" ADD CONSTRAINT "CustomerAccess_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
