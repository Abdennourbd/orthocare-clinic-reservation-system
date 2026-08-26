import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  AuditAction,
  CancelReason,
  SmsMessageType,
} from "@/generated/prisma/client";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { sendMessage } from "@/lib/messaging";
import { localParts } from "@/lib/messaging/format";
import { notifyPendingExpired } from "@/lib/messaging/notifications";
import { logAction, SYSTEM_ACTOR } from "@/lib/audit/logAction";
import { readBookingPolicy } from "@/lib/booking/policy";
import {
  releaseSlot,
  AppointmentAlreadyReleasedError,
} from "@/lib/booking/releaseSlot";

// Task 9 — PENDING expiry cron (`/api/cron/expire-pending`).
//
// Auto-cancels unconfirmed PENDING bookings that have outlived
// `pendingExpiryHours` (default 24h) — and always before/once the appointment
// would start — through the shared `releaseSlot()` so the slot returns to
// availability and the slot-freed event fires (the waitlist subscriber,
// Task 17, is notified exactly like any other cancellation).
//
// Idempotent: the query only matches rows still PENDING, and `releaseSlot`
// itself refuses to release an appointment that is no longer active — a
// second run matches zero rows. The patient gets one EXPIRED message
// (`(appointmentId, type)` unique index) and staff get one PENDING_EXPIRED
// notification.

/**
 * Auto-cancel stale PENDING bookings via `releaseSlot(AUTO_EXPIRED)`.
 * @param nowUTC fixed "now" (tests); defaults to the real clock.
 * @returns the number of appointments newly expired.
 */
export async function expirePendingBookings(nowUTC: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const policy = await readBookingPolicy();
  const staleBefore = new Date(
    nowUTC.getTime() - policy.pendingExpiryHours * 3600_000,
  );

  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.PENDING,
      // The expiry window targets ONLINE bookings. Manual bookings are created
      // CONFIRMED (Task 14); if a MANUAL PENDING ever exists (e.g. a phone
      // booking awaiting a confirm call), that is a staff decision, not an
      // auto-expiry target.
      source: AppointmentSource.ONLINE,
      OR: [
        { createdAt: { lte: staleBefore } },
        { startTime: { lte: nowUTC } },
      ],
    },
    include: { patient: true, service: true },
  });

  let expired = 0;
  for (const a of appointments) {
    try {
      await releaseSlot(a.id, CancelReason.AUTO_EXPIRED);
    } catch (e) {
      // A concurrent cancel/reschedule already freed the slot — skip.
      if (e instanceof AppointmentAlreadyReleasedError) continue;
      throw e;
    }

    await sendMessage({
      type: SmsMessageType.EXPIRED,
      patientId: a.patientId,
      to: a.patient.phoneE164,
      appointmentId: a.id,
      templateKey: "expired",
      vars: {
        firstName: a.patient.firstName,
        serviceName: localized(a.service.name as LocalizedField, "fr"),
        ...localParts(a.startTime),
      },
    });

    await notifyPendingExpired({
      appointmentId: a.id,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      serviceId: a.serviceId,
      serviceName: a.service.name as unknown as Record<string, string>,
      startTime: a.startTime.toISOString(),
      cancelReason: CancelReason.AUTO_EXPIRED,
    });

    await logAction(SYSTEM_ACTOR, AuditAction.APPOINTMENT_AUTO_CANCELLED, "Appointment", a.id, {
      cancelReason: CancelReason.AUTO_EXPIRED,
    });
    expired++;
  }
  return expired;
}