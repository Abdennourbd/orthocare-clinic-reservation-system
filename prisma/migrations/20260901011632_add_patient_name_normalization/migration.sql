-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "firstNameNormalized" TEXT,
ADD COLUMN     "lastNameNormalized" TEXT;

-- CreateIndex
CREATE INDEX "Patient_firstNameNormalized_lastNameNormalized_idx" ON "Patient"("firstNameNormalized", "lastNameNormalized");
