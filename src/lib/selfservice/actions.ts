import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
  type Appointment,
} from "@/generated/prisma/client";
import { releaseSlot } from "@/lib/booking/releaseSlot";
import { rescheduleSlot } from "@/lib/booking/rescheduleSlot";
import { logAction } from "@/lib/audit/logAction";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import {
  sendAppointmentCancelled,
  sendAppointmentRescheduled,
} from "@/lib/messaging/appointmentChanges";
import { notifyCancellation } from "@/lib/messaging/notifications";
import { verifySelfServiceToken } from "./tokens";

export { SlotConflictError } from "@/lib/booking/errors";
export {
  AppointmentNotActiveError,
  SelfServiceTokenExpiredError,
  SelfServiceTokenNotFoundError,
  SelfServiceTokenRevokedError,
  SelfServiceTokenUsedError,
} from "./errors";

export type SelfServiceCancelResult = {
  appointment: Appointment;
};

/**
 * Cancel an appointment through the self-service link. Routes through
 * `releaseSlot()` (so the slot-freed event fires for the waitlist, Task 17),
 * marks the single-use token as used, messages the patient, notifies staff and
 * audits with actor PATIENT. The appointment must still be active — the token
 * verification enforces it.
 */
export async function selfServiceCancel(
  rawToken: string,
  ipAddress?: string | null,
): Promise<SelfServiceCancelResult> {
  const { token, appointment } = await verifySelfServiceToken(rawToken);

  const released = await releaseSlot(
    appointment.id,
    CancelReason.PATIENT_SELF_SERVICE,
  );

  // Single-use: mark the token consumed. Only reached if releaseSlot succeeded
  // (it is atomic, so a concurrent double-cancel loses here).
  await getPrisma().selfServiceToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  });

  // Side effects never fail the cancel itself.
  await safe(() => sendAppointmentCancelled(appointment.id));
  await safe(() =>
    notifyCancellation({
      appointmentId: appointment.id,
      patientName:
        `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim(),
      serviceId: appointment.serviceId,
      serviceName: appointment.service.name as Record<string, string>,
      startTime: appointment.startTime.toISOString(),
      reason: "patient-self-service",
    }),
  );
  await logAction(
    { type: AuditActorType.PATIENT },
    AuditAction.SELF_SERVICE_CANCELLED,
    "Appointment",
    appointment.id,
    {
      cancelReason: "patient-self-service",
      cancelReasonValue: CancelReason.PATIENT_SELF_SERVICE,
      serviceId: appointment.serviceId,
      startTime: appointment.startTime.toISOString(),
    },
    ipAddress,
  );

  return { appointment: released };
}

export type SelfServiceRescheduleResult = {
  oldAppointment: Appointment;
  newAppointment: Appointment;
  /** The rotated token's raw value (embedded in the reschedule SMS). */
  newRawToken: string | null;
};

/**
 * Reschedule an appointment through the self-service link. Atomically
 * releases the old slot and books the new one (`rescheduleSlot`), producing a
 * CONFIRMED appointment (the patient was already confirmed by phone). The old
 * token is marked used+revoked (rotation), the reschedule message carries the
 * fresh token, and the action is audited with actor PATIENT.
 */
export async function selfServiceReschedule(
  rawToken: string,
  newStartUTC: Date,
  ipAddress?: string | null,
): Promise<SelfServiceRescheduleResult> {
  const { token, appointment } = await verifySelfServiceToken(rawToken);

  const { oldAppointment, newAppointment } = await rescheduleSlot({
    appointmentId: appointment.id,
    newStartUTC,
    reason: CancelReason.PATIENT_SELF_SERVICE,
    // The patient was confirmed by phone already — no re-confirmation needed.
    newStatus: AppointmentStatus.CONFIRMED,
  });

  // Rotate: the old token is dead (used + revoked), a fresh one is issued for
  // the new appointment inside the reschedule message helper.
  await getPrisma().selfServiceToken.update({
    where: { id: token.id },
    data: { usedAt: new Date(), revokedAt: new Date() },
  });

  const newRawToken = await safe(() =>
    sendAppointmentRescheduled(appointment.id, newAppointment.id),
  );

  await logAction(
    { type: AuditActorType.PATIENT },
    AuditAction.SELF_SERVICE_RESCHEDULED,
    "Appointment",
    appointment.id,
    {
      newAppointmentId: newAppointment.id,
      oldStart: oldAppointment.startTime.toISOString(),
      newStart: newAppointment.startTime.toISOString(),
      serviceId: appointment.serviceId,
      serviceName: localized(
        appointment.service.name as LocalizedField,
        "fr",
      ),
    },
    ipAddress,
  );

  return { oldAppointment, newAppointment, newRawToken };
}

/** Run a side effect, swallowing failures so the main action always wins. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error("self-service side effect failed", e);
    return null;
  }
}