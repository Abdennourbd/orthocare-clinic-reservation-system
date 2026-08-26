import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  SmsMessageType,
} from "@/generated/prisma/client";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { sendMessage } from "@/lib/messaging";
import { localParts } from "@/lib/messaging/format";
import { notifyNoShowAlert } from "@/lib/messaging/notifications";
import { logAction, SYSTEM_ACTOR } from "@/lib/audit/logAction";

// Task 9 — no-show follow-up cron (`/api/cron/no-show-followup`).
//
// Marks CONFIRMED appointments whose window has fully passed (endTime < now)
// as NO_SHOW, sets `noShowAt`, sends the follow-up SMS and alerts staff.
// Idempotent: the `updateMany` guard only transitions a row that is still
// CONFIRMED, so a second run matches zero rows and marks nothing (a
// concurrent cancel/reschedule makes the transition a no-op too). The
// follow-up SMS is non-transactional, so the dispatcher suppresses it for
// patients with `messagingOptOut` while the NO_SHOW status is still recorded.

/**
 * Mark past CONFIRMED appointments as NO_SHOW and send the follow-up.
 * @param nowUTC fixed "now" (tests); defaults to the real clock.
 * @returns the number of appointments newly marked NO_SHOW.
 */
export async function markNoShows(nowUTC: Date = new Date()): Promise<number> {
  const prisma = getPrisma();

  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      endTime: { lt: nowUTC },
    },
    include: { patient: true, service: true },
  });

  let marked = 0;
  for (const a of appointments) {
    const { count } = await prisma.appointment.updateMany({
      where: { id: a.id, status: AppointmentStatus.CONFIRMED },
      data: { status: AppointmentStatus.NO_SHOW, noShowAt: nowUTC },
    });
    if (count === 0) continue;

    await sendMessage({
      type: SmsMessageType.NO_SHOW,
      patientId: a.patientId,
      to: a.patient.phoneE164,
      appointmentId: a.id,
      templateKey: "noShow",
      vars: {
        firstName: a.patient.firstName,
        serviceName: localized(a.service.name as LocalizedField, "fr"),
        ...localParts(a.startTime),
      },
    });

    await notifyNoShowAlert({
      appointmentId: a.id,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      serviceId: a.serviceId,
      serviceName: a.service.name as unknown as Record<string, string>,
      startTime: a.startTime.toISOString(),
    });

    await logAction(SYSTEM_ACTOR, AuditAction.APPOINTMENT_NO_SHOW, "Appointment", a.id, {
      noShowAt: nowUTC.toISOString(),
    });
    marked++;
  }
  return marked;
}