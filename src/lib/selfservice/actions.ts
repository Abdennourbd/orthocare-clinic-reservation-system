import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
  type Appointment,
} from "@/generated/prisma/client";
import { releaseSlotInTx } from "@/lib/booking/releaseSlot";
import { rescheduleSlot } from "@/lib/booking/rescheduleSlot";
import { emitSlotFreed } from "@/lib/booking/events";
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

  // Release the slot AND consume the single-use token in ONE transaction, so
  // a failure can never leave the appointment cancelled with an unconsumed
  // token (or an active appointment with a dead one). The `updateMany` guard
  // inside `releaseSlotInTx` still makes a concurrent double-cancel lose here.
  // Mirrors `releaseSlot`'s contract: the slot-freed event fires only after
  // commit.
  const released = await getPrisma().$transaction(async (tx) => {
    const r = await releaseSlotInTx(
      appointment.id,
      CancelReason.PATIENT_SELF_SERVICE,
      AppointmentStatus.CANCELLED,
      tx,
    );
    await tx.selfServiceToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return r;
  });

  emitSlotFreed({
    appointmentId: released.id,
    serviceId: released.serviceId,
    resourceId: released.resourceId,
    startTime: released.startTime,
    endTime: released.endTime,
  });

  // Side effects never fail the cancel itself.
  await safe(() => sendAppointmentCancelled(appointment.id));
  await safe(() =>
    notifyCancellation({
      appointmentId: appointment.id,
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
      cancelReason: CancelReason.PATIENT_SELF_SERVICE,
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
  //
  // NOTE on ordering: the rotation runs AFTER `rescheduleSlot` commits rather
  // than inside its transaction, because `rescheduleSlot` is a shared domain
  // function that must not know about tokens — and rotating BEFORE it would
  // leave the patient unable to retry when the new slot is taken (the
  // transaction rolls back but the token is already dead). The status change
  // alone enforces the security property: the old appointment becomes
  // RESCHEDULED, so `verifySelfServiceToken` rejects its token even if this
  // update were skipped.
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