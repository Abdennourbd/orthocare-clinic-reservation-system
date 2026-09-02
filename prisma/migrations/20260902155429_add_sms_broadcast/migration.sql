-- CreateTable
CREATE TABLE "SmsBroadcast" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsBroadcast_idempotencyKey_key" ON "SmsBroadcast"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SmsBroadcast_createdAt_idx" ON "SmsBroadcast"("createdAt");

-- AddForeignKey
ALTER TABLE "SmsBroadcast" ADD CONSTRAINT "SmsBroadcast_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
