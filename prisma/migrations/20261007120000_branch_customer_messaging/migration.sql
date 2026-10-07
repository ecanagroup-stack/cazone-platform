ALTER TABLE "ChatMessage" ADD COLUMN "branchId" TEXT;

-- Preserve historical conversations without guessing when a customer belonged to multiple branches.
UPDATE "ChatMessage" AS message
SET "branchId" = access."branchId"
FROM "CustomerAccess" AS access
WHERE access."customerId" = message."customerId"
  AND (SELECT COUNT(*) FROM "CustomerAccess" AS siblings WHERE siblings."customerId" = message."customerId") = 1;

CREATE INDEX "ChatMessage_organizationId_branchId_customerId_createdAt_idx"
  ON "ChatMessage"("organizationId", "branchId", "customerId", "createdAt");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
