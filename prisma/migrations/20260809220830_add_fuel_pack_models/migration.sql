-- CreateTable
CREATE TABLE "Tank" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capacity" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispenser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tankId" TEXT,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispenser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dispenserId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "opening" DOUBLE PRECISION NOT NULL,
    "closing" DOUBLE PRECISION,
    "rtt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discrepancyFlag" BOOLEAN NOT NULL DEFAULT false,
    "discrepancyNote" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "employmentType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendantNote" (
    "id" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendantNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendantAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dispenserId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tank_organizationId_idx" ON "Tank"("organizationId");

-- CreateIndex
CREATE INDEX "Tank_branchId_idx" ON "Tank"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Tank_branchId_label_key" ON "Tank"("branchId", "label");

-- CreateIndex
CREATE INDEX "Dispenser_organizationId_idx" ON "Dispenser"("organizationId");

-- CreateIndex
CREATE INDEX "Dispenser_branchId_idx" ON "Dispenser"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispenser_branchId_label_key" ON "Dispenser"("branchId", "label");

-- CreateIndex
CREATE INDEX "MeterReading_organizationId_idx" ON "MeterReading"("organizationId");

-- CreateIndex
CREATE INDEX "MeterReading_branchId_idx" ON "MeterReading"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_shiftId_dispenserId_key" ON "MeterReading"("shiftId", "dispenserId");

-- CreateIndex
CREATE INDEX "Attendant_organizationId_idx" ON "Attendant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendant_branchId_staffNumber_key" ON "Attendant"("branchId", "staffNumber");

-- CreateIndex
CREATE INDEX "AttendantNote_attendantId_idx" ON "AttendantNote"("attendantId");

-- CreateIndex
CREATE INDEX "AttendantAssignment_organizationId_idx" ON "AttendantAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "AttendantAssignment_shiftId_dispenserId_idx" ON "AttendantAssignment"("shiftId", "dispenserId");

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tank" ADD CONSTRAINT "Tank_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispenser" ADD CONSTRAINT "Dispenser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispenser" ADD CONSTRAINT "Dispenser_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispenser" ADD CONSTRAINT "Dispenser_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_dispenserId_fkey" FOREIGN KEY ("dispenserId") REFERENCES "Dispenser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendant" ADD CONSTRAINT "Attendant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendant" ADD CONSTRAINT "Attendant_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantNote" ADD CONSTRAINT "AttendantNote_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "Attendant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_dispenserId_fkey" FOREIGN KEY ("dispenserId") REFERENCES "Dispenser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "Attendant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
