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
 * Grace period between an appointment's end and its no-show marking.
 * The 18:00 run must not rewrite today's attendance data: a 10:00 patient
 * the desk simply forgot to mark COMPLETED actually attended, and a
 * "vous n'êtes pas venu" SMS plus a corrupted KPI rate is worse than a
 * one-day delay. Staff have until the next day's run to close out the day.
 */
const NO_SHOW_GRACE_MS = 12 * 3600_000;
//
// Grace period: only appointments ending more than NO_SHOW_GRACE_MS ago are
// marked. The run happens at 18:00 local, right after closing — without a
// grace window, every same-day appointment the desk simply forgot to mark
// COMPLETED would be branded NO_SHOW (and the patient wrongly SMSed). The
// grace gives staff until the next day's run to close out the day, and keeps
// the KPI no-show rate honest.

/**
 * Mark past CONFIRMED appointments as NO_SHOW and send the follow-up.
 * @param nowUTC fixed "now" (tests); defaults to the real clock.
 * @returns the number of appointments newly marked NO_SHOW.
 */
export async function markNoShows(nowUTC: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const cutoff = new Date(nowUTC.getTime() - NO_SHOW_GRACE_MS);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      endTime: { lt: cutoff },
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