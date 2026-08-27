-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "normalizedName" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_normalizedName_key" ON "Customer"("organizationId", "normalizedName");

