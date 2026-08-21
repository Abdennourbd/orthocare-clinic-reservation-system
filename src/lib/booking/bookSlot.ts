import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  type Appointment,
  type Prisma,
} from "@/generated/prisma/client";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { isSlotBookable } from "@/lib/slots/engine";
import { loadSlotContext } from "./loadSlotContext";
import { SlotConflictError } from "./errors";

export { SlotConflictError } from "./errors";

export type BookSlotInput = {
  patientId: string;
  serviceId: string;
  startUTC: Date;
  resourceId?: string | null;
  source?: AppointmentSource;
};

/**
 * Atomically books a slot. See `bookSlotInTx` for the concurrency model.
 */
export async function bookSlot(input: BookSlotInput): Promise<Appointment> {
  return getPrisma().$transaction(async (tx) => bookSlotInTx(input, tx));
}

/**
 * The transactional body of `bookSlot`, exposed so `rescheduleSlot` can run
 * it inside a larger transaction.
 *
 * A Postgres transaction-level advisory lock keyed on (resource, clinic-local
 * day) serializes all bookings for the same chair on the same day. Inside the
 * lock, the window is re-checked against the *current* DB state via
 * `isSlotBookable` (working hours, lead time, horizon, overlap, closures) and
 * the appointment is inserted. Because the lock makes concurrent bookings for
 * the same resource+day run one-at-a-time, the re-check is race-free: exactly
 * one of two concurrent bookings for the same slot wins, the other throws a
 * `SlotConflictError`.
 */
export async function bookSlotInTx(
  input: BookSlotInput,
  tx: Prisma.TransactionClient,
): Promise<Appointment> {
  const nowUTC = new Date();
  const localDateString = toClinicLocalDateString(input.startUTC);
  const resourceKey = input.resourceId ?? "single";

  await tx.$queryRaw<
    Array<{ result: string }>
  >`SELECT CAST(pg_advisory_xact_lock(hashtext(${`booking:${resourceKey}:${localDateString}`})) AS text) AS "result"`;

  const { service, bookability } = await loadSlotContext(tx, {
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    startUTC: input.startUTC,
    nowUTC,
  });

  const endTime = new Date(
    input.startUTC.getTime() + service.durationMinutes * 60_000,
  );

  if (!isSlotBookable(input.startUTC, endTime, bookability)) {
    throw new SlotConflictError();
  }

  return tx.appointment.create({
    data: {
      patientId: input.patientId,
      serviceId: input.serviceId,
      startTime: input.startUTC,
      endTime,
      status: AppointmentStatus.PENDING,
      source: input.source ?? AppointmentSource.ONLINE,
      resourceId: input.resourceId ?? null,
    },
  });
}
