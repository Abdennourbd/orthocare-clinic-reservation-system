-- CreateEnum
CREATE TYPE "SmsMessageType" AS ENUM ('BOOKING_RECEIVED', 'CONFIRMATION', 'REMINDER', 'NO_SHOW', 'MANUAL', 'RESCHEDULE', 'DELAY', 'WAITLIST', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_BOOKING', 'CANCELLATION', 'WAITLIST_MATCH', 'NO_SHOW_ALERT', 'PENDING_EXPIRED');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "preferredLocale" TEXT NOT NULL DEFAULT 'fr',
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "patientId" TEXT,
    "type" "SmsMessageType" NOT NULL,
    "templateId" TEXT,
    "batchId" TEXT,
    "provider" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "appointmentId" TEXT,
    "sentById" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_patientId_idx" ON "SmsMessage"("patientId");

-- CreateIndex
CREATE INDEX "SmsMessage_batchId_idx" ON "SmsMessage"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_appointmentId_type_key" ON "SmsMessage"("appointmentId", "type");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
