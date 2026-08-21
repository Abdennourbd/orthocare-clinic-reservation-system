import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  CancelReason,
  type Appointment,
  type Prisma,
} from "@/generated/prisma/client";
import { emitSlotFreed } from "./events";
import {
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "./errors";

export {
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "./errors";

/**
 * Shared cancellation path. Sets the appointment to CANCELLED with a
 * `cancelReason` and `cancelledAt`, then emits a `slot-freed` event so the
 * waitlist (Task 17) and any other subscribers can react. Every path that
 * frees a slot (staff cancel, self-service cancel, auto-expiry, reschedule)
 * routes through here.
 *
 * Idempotency guard: releasing an appointment that is no longer active
 * (already CANCELLED/RESCHEDULED/COMPLETED/NO_SHOW) throws
 * `AppointmentAlreadyReleasedError` rather than double-emitting.
 */
export async function releaseSlot(
  appointmentId: string,
  reason: CancelReason,
): Promise<Appointment> {
  const released = await getPrisma().$transaction((tx) =>
    releaseSlotInTx(appointmentId, reason, AppointmentStatus.CANCELLED, tx),
  );

  // Emit only after the transaction commits, so subscribers never see a
  // slot-freed event for a release that failed.
  emitSlotFreed({
    appointmentId: released.id,
    resourceId: released.resourceId,
    startTime: released.startTime,
    endTime: released.endTime,
  });

  return released;
}

/**
 * The transactional body of `releaseSlot`, exposed so `rescheduleSlot` can run
 * it inside a larger transaction. Does NOT emit the slot-freed event (the
 * caller — `releaseSlot` or `rescheduleSlot` — does that after commit).
 *
 * `targetStatus` lets a reschedule mark the old appointment RESCHEDULED rather
 * than CANCELLED while still recording the `cancelReason`.
 */
export async function releaseSlotInTx(
  appointmentId: string,
  reason: CancelReason,
  targetStatus: AppointmentStatus,
  tx: Prisma.TransactionClient,
): Promise<Appointment> {
  const activeStatuses: AppointmentStatus[] = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
  ];

  // Atomic guard: the WHERE clause only matches an appointment that is still
  // active, so two concurrent releases of the same appointment cannot both
  // pass (one update matches, the other matches zero rows). Without this,
  // `findUnique`-then-`update` would be a TOCTOU race and both callers would
  // emit a slot-freed event.
  const { count } = await tx.appointment.updateMany({
    where: { id: appointmentId, status: { in: activeStatuses } },
    data: {
      status: targetStatus,
      cancelReason: reason,
      cancelledAt: new Date(),
    },
  });

  if (count === 0) {
    const existing = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    throw new AppointmentAlreadyReleasedError(appointmentId);
  }

  const released = await tx.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!released) {
    // Unreachable in practice (the row was just updated), but keeps the
    // return type honest without a non-null assertion.
    throw new AppointmentNotFoundError(appointmentId);
  }

  return released;
}
