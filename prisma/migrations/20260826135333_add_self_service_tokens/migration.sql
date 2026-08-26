-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'SYSTEM', 'PATIENT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_COMPLETED', 'APPOINTMENT_NO_SHOW', 'APPOINTMENT_AUTO_CANCELLED', 'PATIENT_CREATED', 'PATIENT_UPDATED', 'PATIENT_ANONYMIZED', 'SMS_SENT', 'PATIENT_DOCUMENT_UPLOADED', 'PATIENT_DOCUMENT_DELETED', 'TEAM_MEMBER_CREATED', 'TEAM_MEMBER_DEACTIVATED', 'TEAM_MEMBER_ROLE_CHANGED', 'SETTINGS_UPDATED', 'CLOSURE_CREATED', 'CLOSURE_DELETED', 'WAITLIST_ENTRY_ADDED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGOUT', 'PASSWORD_RESET', 'PATIENT_RECORD_VIEWED', 'PATIENT_DOCUMENT_DOWNLOADED', 'EXPORT_GENERATED', 'AUDIT_VIEWED', 'SELF_SERVICE_CANCELLED', 'SELF_SERVICE_RESCHEDULED');

-- AlterEnum
ALTER TYPE "SmsMessageType" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "SelfServiceToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfServiceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfServiceToken_tokenHash_key" ON "SelfServiceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SelfServiceToken_appointmentId_idx" ON "SelfServiceToken"("appointmentId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SelfServiceToken" ADD CONSTRAINT "SelfServiceToken_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
