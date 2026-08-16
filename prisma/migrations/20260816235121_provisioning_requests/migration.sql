-- CreateTable
CREATE TABLE "ProvisioningRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serviceType" TEXT,
    "serviceId" TEXT,
    "branchName" TEXT,
    "note" TEXT,
    "requestedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "quotedAmount" INTEGER,
    "quotedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisioningRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProvisioningRequest_organizationId_idx" ON "ProvisioningRequest"("organizationId");

-- AddForeignKey
ALTER TABLE "ProvisioningRequest" ADD CONSTRAINT "ProvisioningRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvisioningRequest" ADD CONSTRAINT "ProvisioningRequest_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
