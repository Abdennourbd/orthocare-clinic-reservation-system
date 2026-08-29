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
import { normalizeName } from "@/lib/patients/duplicates";

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

/**
 * Task 13 étape 4 tour 2 — resolves on phone AND normalized name, never phone
 * alone (ortho-security BLOCKING finding, user-authorized fix to this Task 6
 * file: task-13.md étape 4 §"La décision de l'utilisateur : option B"). Phone
 * sharing is legitimate — Algerian families commonly share one phone, which
 * is exactly why `phoneE164` is indexed but deliberately NOT `@unique`
 * (prisma/schema.prisma:97) — so this must not (and cannot) forbid it. The
 * defect it closes: resolving `findFirst({ phoneE164 }, orderBy: createdAt
 * desc)` picked whichever record shared the number was created MOST
 * RECENTLY, regardless of whose identity was actually booking, and then
 * overwrote that record's firstName/lastName/etc — silently relabeling one
 * family member's clinical history with another's name, with no warning and
 * no audit trail. Matching on phone+name means a booking only ever updates
 * the record that is actually that person; an unrecognized name on a known,
 * shared phone creates a new record instead of overwriting a stranger's.
 */
async function upsertPatient(
  tx: Prisma.TransactionClient,
  input: CreateBookingPatientInput,
): Promise<Patient> {
  const candidates = await tx.patient.findMany({
    // `anonymizedAt: null` (task-13.md étape 5, §Contraintes point 7 — prepares
    // étape 6's erasure): without this, a public booking could resolve onto an
    // already-anonymized record sharing this phone and silently re-write a
    // real name/email/birthDate over a fiche whose whole point is to no
    // longer carry identifying data — undoing a right-to-be-forgotten request
    // with zero warning. A phone/name match on an anonymized record now
    // always falls through to `create`, same as no match at all.
    where: { phoneE164: input.phoneE164, anonymizedAt: null },
    // Task 13 étape 4 tour 3 (ortho-security counter-check): `createdAt` alone
    // has no tiebreaker. Two rows can share the same millisecond (`timestamp(3)`
    // column), and Postgres then returns them in physical row order, NOT
    // insertion order — an `UPDATE` on one of them (exactly what this function
    // does below) can flip that physical order on the next query. `id` is the
    // deterministic tiebreak already used elsewhere in this repo
    // (src/app/api/admin/audit/route.ts, src/app/api/admin/patients/route.ts).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const normalizedFirst = normalizeName(input.firstName);
  const normalizedLast = normalizeName(input.lastName);
  // `candidates` is deterministically ordered (createdAt desc, id desc as
  // tiebreak), so `.find()` picks the same record every time among any that
  // happen to share both phone and name. It does NOT reliably mean "most
  // recently created" when several candidates tie on `createdAt` — the
  // tiebreak on `id` is a stable, arbitrary order, not a recency guarantee.
  const existing = candidates.find(
    (c) =>
      normalizeName(c.firstName) === normalizedFirst &&
      normalizeName(c.lastName) === normalizedLast,
  );

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
    // `active` is deliberately NOT forced true here anymore (ortho-security
    // BLOCKING finding, task-13.md étape 4 tour 2): étape 5 gives ADMIN a
    // soft-delete (`active: false`). A public booking must never silently
    // reverse that — if the record's real owner books again, staff must
    // reactivate them as a conscious act, not as a side-effect of Task 6
    // code they never touch. A brand-new record still defaults to
    // `active: true` (prisma/schema.prisma `@default(true)`), unaffected by
    // this change.
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