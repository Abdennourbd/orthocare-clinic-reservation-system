import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { sendMessage } from "@/lib/messaging";
import { localParts } from "@/lib/messaging/format";
import { logActionSafe, SYSTEM_ACTOR } from "@/lib/audit/logAction";

// Task 9 — reminder cron (`/api/cron/reminders`).
//
// Sends the 24h-before reminder to CONFIRMED appointments whose start falls
// in the next 24h. Idempotent by construction:
//   - the query only picks appointments with `reminderSentAt = null`, so a
//     second run has nothing to do;
//   - the `(appointmentId, type)` unique index on SmsMessage means even a
//     racing run cannot create a second reminder row.
// `reminderSentAt` is set ONLY when the message actually went out (SENT). A
// provider failure leaves it null so the next run re-attempts the same row
// (the dispatcher retries a FAILED row instead of silently skipping it) —
// a transient outage must never mean the patient never gets reminded.

/**
 * Send reminders to CONFIRMED appointments starting within the next 24 hours.
 * @param nowUTC fixed "now" (tests); defaults to the real clock.
 * @returns the number of reminders actually delivered (SENT).
 */
export async function sendReminders(nowUTC: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const windowEnd = new Date(nowUTC.getTime() + 24 * 3600_000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      reminderSentAt: null,
      startTime: { gte: nowUTC, lte: windowEnd },
    },
    include: { patient: true, service: true },
  });

  let sent = 0;
  for (const a of appointments) {
    // Re-check status right before sending: a cancellation/reschedule that
    // landed between the fetch and now must not receive a reminder. (A cancel
    // during the send itself is inherently unresolvable — messaging is
    // external I/O — but this closes the practical window.)
    const fresh = await prisma.appointment.findUnique({
      where: { id: a.id },
      select: { status: true },
    });
    if (fresh?.status !== AppointmentStatus.CONFIRMED) continue;

    const msg = await sendMessage({
      type: SmsMessageType.REMINDER,
      patientId: a.patientId,
      to: a.patient.phoneE164,
      appointmentId: a.id,
      templateKey: "reminder",
      vars: {
        firstName: a.patient.firstName,
        serviceName: localized(a.service.name as LocalizedField, "fr"),
        ...localParts(a.startTime),
      },
    });
    if (msg && msg.status === SmsStatus.SENT) {
      await prisma.appointment.update({
        where: { id: a.id },
        data: { reminderSentAt: nowUTC },
      });
      await logActionSafe(SYSTEM_ACTOR, AuditAction.SMS_SENT, "Appointment", a.id, {
        messageType: SmsMessageType.REMINDER,
      });
      sent++;
    }
  }
  return sent;
}