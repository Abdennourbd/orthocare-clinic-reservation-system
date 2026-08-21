import { getPrisma } from "@/lib/db";
import { AppointmentStatus, CancelReason, type Appointment } from "@/generated/prisma/client";
import { bookSlotInTx, type BookSlotInput } from "./bookSlot";
import { releaseSlotInTx } from "./releaseSlot";
import { emitSlotFreed } from "./events";
export type RescheduleSlotInput = {
  appointmentId: string;
  newStartUTC: Date;
  /** Who initiated the reschedule — recorded as the old appointment's cancelReason. */
  reason: CancelReason;
  resourceId?: string | null;
  source?: BookSlotInput["source"];
};

export type RescheduleSlotResult = {
  oldAppointment: Appointment;
  newAppointment: Appointment;
};

/**
 * Atomically reschedules an appointment: the old slot is released (marked
 * RESCHEDULED with a cancel reason) and the new slot is booked, all within a
 * single transaction so a failure rolls back both. On success a `slot-freed`
 * event fires for the old appointment.
 */
export async function rescheduleSlot(
  input: RescheduleSlotInput,
): Promise<RescheduleSlotResult> {
  const { oldAppointment, newAppointment } = await getPrisma().$transaction(
    async (tx) => {
      const old = await releaseSlotInTx(
        input.appointmentId,
        input.reason,
        AppointmentStatus.RESCHEDULED,
        tx,
      );

      const neu = await bookSlotInTx(
        {
          patientId: old.patientId,
          serviceId: old.serviceId,
          startUTC: input.newStartUTC,
          resourceId: input.resourceId,
          source: input.source,
        },
        tx,
      );

      return { oldAppointment: old, newAppointment: neu };
    },
  );

  // Emit only AFTER the whole transaction commits, so subscribers never see
  // a slot-freed event for a reschedule that rolled back.
  emitSlotFreed({
    appointmentId: oldAppointment.id,
    resourceId: oldAppointment.resourceId,
    startTime: oldAppointment.startTime,
    endTime: oldAppointment.endTime,
  });

  return { oldAppointment, newAppointment };
}
