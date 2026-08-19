-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");
