-- CreateTable
CREATE TABLE "SmileCase" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "beforeImageUrl" TEXT NOT NULL,
    "afterImageUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredOrder" INTEGER NOT NULL DEFAULT 0,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmileCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmileCaseImage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmileCaseImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmileCase_key_key" ON "SmileCase"("key");

-- CreateIndex
CREATE INDEX "SmileCase_active_sortOrder_idx" ON "SmileCase"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "SmileCase_featured_featuredOrder_idx" ON "SmileCase"("featured", "featuredOrder");

-- CreateIndex
CREATE INDEX "SmileCaseImage_caseId_sortOrder_idx" ON "SmileCaseImage"("caseId", "sortOrder");

-- AddForeignKey
ALTER TABLE "SmileCaseImage" ADD CONSTRAINT "SmileCaseImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SmileCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
