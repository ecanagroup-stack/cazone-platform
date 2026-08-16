-- Part C: persistent workspace selection
ALTER TABLE "User" ADD COLUMN "lastServiceId" TEXT;
ALTER TABLE "User" ADD COLUMN "lastBranchId" TEXT;
