import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  WaitlistSource,
  type Appointment,
  type Patient,
  type Prisma,
  type WaitlistEntry,
} from "@/generated/prisma/client";
import { bookSlotInTx } from "./bookSlot";
import { PendingLimitError } from "./errors";
import { toClinicLocalDateString, getClinicDayBoundsUTC } from "@/lib/time/clinicTime";

export type CreateBookingPatientInput = {
  firstName: string;
  lastName: string;
  /** As typed by the patient (display form). */
  phone: string;
  /** Normalized E.164 — duplicate detection and the rate limits key off this. */
  phoneE164: string;
  email?: string | null;
  birthDate?: Date | null;
  consentAt: Date;
  consentVersion: string;
  /** Locale the patient booked in (Task 7 — stored for later messaging). */
  preferredLocale: string;
  /** WhatsApp opt-in (Task 7 — Meta's documented-opt-in requirement). */
  whatsappOptIn: boolean;
};

export type CreateBookingInput = {
  serviceId: string;
  startUTC: Date;
  patient: CreateBookingPatientInput;
  /** Clinic-local dates (YYYY-MM-DD) to watch for freed slots. */
  watchDates?: string[];
  /** Max simultaneously active PENDING bookings per phone (abuse control).
   * Enforced authoritatively inside the transaction, after a per-phone lock. */
  maxActivePending?: number;
};

export type CreateBookingResult = {
  appointment: Appointment;
  patient: Patient;
  waitlistEntry: WaitlistEntry | null;
};

/**
 * Public booking action: upsert the patient (with consent), atomically book
 * the slot, and — when the patient opted in — create a PATIENT-source
 * `WaitlistEntry`, all inside ONE transaction. A failed booking (e.g.
 * `SlotConflictError`) rolls back the patient upsert and the waitlist entry,
 * so no orphan rows survive.
 *
 * A per-phone Postgres advisory lock serializes bookings from the same phone,
 * so concurrent requests cannot both pass the active-PENDING cap and cannot
 * race a `findFirst`-then-create into duplicate patients. `PendingLimitError`
 * is thrown inside the transaction when the cap is exceeded.
 *
 * `watchDates` are stored as each clinic-local date's UTC midnight (the
 * representation `WaitlistEntry.preferredDates` documents), and the booked
 * date itself is excluded — watching the day you already booked is meaningless.
 */
export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  return getPrisma().$transaction(async (tx) => {
    // Serialize all bookings from the same phone so the PENDING-cap re-count
    // and the patient upsert below are race-free.
    await tx.$queryRaw<
      Array<{ result: string }>
    >`SELECT CAST(pg_advisory_xact_lock(hashtext(${`patient:${input.patient.phoneE164}`})) AS text) AS "result"`;

    const patient = await upsertPatient(tx, input.patient);

    if (input.maxActivePending !== undefined) {
      const pendingCount = await tx.appointment.count({
        where: {
          patientId: patient.id,
          status: AppointmentStatus.PENDING,
        },
      });
      if (pendingCount >= input.maxActivePending) {
        throw new PendingLimitError(input.maxActivePending);
      }
    }

    const appointment = await bookSlotInTx(
      {
        patientId: patient.id,
        serviceId: input.serviceId,
        startUTC: input.startUTC,
        source: AppointmentSource.ONLINE,
      },
      tx,
    );

    let waitlistEntry: WaitlistEntry | null = null;
    if (input.watchDates && input.watchDates.length > 0) {
      const bookedDate = toClinicLocalDateString(input.startUTC);
      const preferredDates = [...new Set(input.watchDates)]
        .filter((d) => d !== bookedDate)
        .map((d) => getClinicDayBoundsUTC(d).startUTC);

      if (preferredDates.length > 0) {
        waitlistEntry = await tx.waitlistEntry.create({
          data: {
            patientId: patient.id,
            serviceId: input.serviceId,
            preferredDates,
            source: WaitlistSource.PATIENT,
            active: true,
          },
        });
      }
    }

    return { appointment, patient, waitlistEntry };
  });
}

async function upsertPatient(
  tx: Prisma.TransactionClient,
  input: CreateBookingPatientInput,
): Promise<Patient> {
  const existing = await tx.patient.findFirst({
    where: { phoneE164: input.phoneE164 },
    orderBy: { createdAt: "desc" },
  });

  const shared = {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    consentAt: input.consentAt,
    consentVersion: input.consentVersion,
    // The latest booking reflects the patient's current language/WhatsApp
    // preference, so re-booking in a different language updates it.
    preferredLocale: input.preferredLocale,
    whatsappOptIn: input.whatsappOptIn,
    active: true,
  };

  if (existing) {
    // Only overwrite the optional fields when the patient actually provided
    // them this time. The booking wizard always starts blank, so a re-booking
    // must never silently erase a previously captured email/birthDate.
    return tx.patient.update({
      where: { id: existing.id },
      data: {
        ...shared,
        ...(input.email ? { email: input.email } : {}),
        ...(input.birthDate ? { birthDate: input.birthDate } : {}),
      },
    });
  }

  return tx.patient.create({
    data: {
      ...shared,
      phoneE164: input.phoneE164,
      email: input.email ?? null,
      birthDate: input.birthDate ?? null,
    },
  });
}