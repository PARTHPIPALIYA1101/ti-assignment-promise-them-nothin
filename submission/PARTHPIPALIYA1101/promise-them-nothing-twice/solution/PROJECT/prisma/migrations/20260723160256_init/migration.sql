-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rpmLimit" INTEGER NOT NULL,
    "burstLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "customRpmLimit" INTEGER,
    "customBurstLimit" INTEGER,
    "queueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bucket_backup" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "burstTokens" DOUBLE PRECISION NOT NULL,
    "lastRefill" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bucket_backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_logs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "arrivalTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waitTimeMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_planId_idx" ON "customers"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "bucket_backup_customerId_key" ON "bucket_backup"("customerId");

-- CreateIndex
CREATE INDEX "bucket_backup_customerId_idx" ON "bucket_backup"("customerId");

-- CreateIndex
CREATE INDEX "queue_logs_customerId_idx" ON "queue_logs"("customerId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bucket_backup" ADD CONSTRAINT "bucket_backup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_logs" ADD CONSTRAINT "queue_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
