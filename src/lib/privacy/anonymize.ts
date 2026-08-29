import { getPrisma } from "@/lib/db";
import { logAction, type AuditActor } from "@/lib/audit/logAction";
import { AuditAction } from "@/generated/prisma/client";

// Task 13 step 6 — irreversible erasure. plan.md §Data retention & erasure:
// "because rows are never hard-deleted, an erasure request is satisfied by
// anonymization: identifying fields are scrubbed and `anonymizedAt` is set,
// while the appointment shell remains so historical statistics stay correct.
// Erasure is ADMIN-only and audited."
//
// Everything that could re-identify the patient is scrubbed in ONE
// transaction: the Patient row itself, free-text clinical notes on every
// Appointment and Visit, AND (task-13.md §Exigences point 4, a dated
// 2026-08-28 user ruling that extends the original fiche) the `to`/`body`
// of every SmsMessage ever sent to them — a phone number or a name typed
// into a message body would otherwise survive an "erasure" untouched.
// SmsMessage rows are NEUTRALIZED, never deleted: `status`/`provider`/
// `sentAt`/`type` stay so delivery statistics remain exact, exactly like the
// Appointment/Visit shells below. `error` is also cleared (TOUR 2
// [MAJEUR-2], task-13.md étape 6 relay journal): it holds `e.message` from
// whatever SMS gateway rejected the send, and real gateways routinely echo
// the recipient number back inside that message — latent today because the
// providers are stubs, active from Task 22.
//
// TOUR 2 [MAJEUR-1]: every unused, non-revoked SelfServiceToken belonging to
// this patient is revoked in the same transaction. An unrevoked token is
// live proof that erasure did not actually erase access: it still resolves
// via GET /api/appointments/[token] (first name, service, date) and still
// lets the holder cancel/reschedule — and "someone else saw the SMS link"
// (a shared family phone) is the single most common reason an erasure
// request gets filed in the first place.
//
// TOUR 2 [MAJEUR-3]: any WaitlistEntry for this patient is deactivated and
// its `preferredDates` cleared — otherwise the erased identity stays
// enrolled in a live waitlist that a future Task 17 could treat as a
// notifiable recipient, and `serviceId` + the requested dates are themselves
// a trace of the care being sought.
//
// Deliberately KEPT: Appointment rows (id, dates, serviceId, status, status
// timestamps) and Visit rows (id, date, serviceId, type) — counters and KPIs
// must stay correct after an erasure, only identity and free text are
// removed. `Visit.type` is a Zod-bounded enum-like string (visitCreateSchema,
// @/schemas/patient) written nowhere else, so nothing identifying can hide
// in it — see task-13.md étape 1 Journal, [MAJEUR-2] dette for the reasoning.
//
// Idempotent, and ACTUALLY race-safe (TOUR 2 [MAJEUR-4] — the previous
// version of this comment was wrong, disproven empirically by ortho-security
// with two concurrent psql sessions: `$transaction()` runs at Postgres'
// default READ COMMITTED, and a `findUnique` is not `SELECT ... FOR UPDATE`,
// so two concurrent callers could both read `anonymizedAt: null`, both
// proceed, and both `UPDATE 1` — producing two PATIENT_ANONYMIZED audit rows
// (indelible, AuditLog is append-only) and a re-stamped `anonymizedAt`, which
// is supposed to be the timestamped proof of when erasure happened). The fix
// makes the claim itself the guard, not a read-then-write check: the very
// first write is `tx.patient.updateMany({ where: { id, anonymizedAt: null },
// ... })`, and only the caller whose `updateMany` actually matched a row
// (`count === 1`) proceeds to scrub the rest. Postgres itself serializes two
// concurrent `UPDATE`s that target the same row — the loser's `WHERE
// anonymizedAt IS NULL` simply matches zero rows once the winner has
// committed (or, inside one transaction, once the winner's UPDATE holds the
// row lock), so `count === 0` is a true, mutually-exclusive "someone else
// already claimed this" signal. Anything that further matches zero rows
// throws `PatientAlreadyAnonymizedError`, so the route answers 409
// ALREADY_ANONYMIZED — the caller never learns whether that's because the
// patient was already erased or never existed; a cheap follow-up
// `findUnique` inside the same transaction is used only to pick which typed
// error to throw (PatientNotFoundError vs PatientAlreadyAnonymizedError), a
// distinction that carries no atomicity requirement of its own since the
// "did we write" decision was already made and locked in by the conditional
// `updateMany` above it.
//
// The audit write happens AFTER the transaction commits (same pattern as
// selfServiceCancel/selfServiceReschedule, src/lib/selfservice/actions.ts):
// `logAction()` uses the shared Prisma singleton, not the transaction's `tx`,
// so it cannot itself be part of the atomic write. `detail` carries ONLY
// counts (`appointmentsKept`, `visitsKept`, `smsMessagesScrubbed`,
// `selfServiceTokensRevoked`, `waitlistEntriesDeactivated`) — never any of
// the values just erased; the audit log is the proof erasure happened, not a
// backup of what it erased.

/** A second anonymize call on an already-erased patient. Maps to HTTP 409. */
export class PatientAlreadyAnonymizedError extends Error {
  constructor() {
    super("Cette fiche a déjà été anonymisée.");
    this.name = "PatientAlreadyAnonymizedError";
  }
}

/** The patient id does not exist. Maps to HTTP 404. Defense in depth only —
 * the route is expected to have already checked existence before calling
 * this function (task-13.md §Ordre des gardes: 404 before 409). */
export class PatientNotFoundError extends Error {
  constructor() {
    super("Patient introuvable.");
    this.name = "PatientNotFoundError";
  }
}

export interface AnonymizePatientResult {
  id: string;
  anonymizedAt: Date;
  appointmentsKept: number;
  visitsKept: number;
  smsMessagesScrubbed: number;
  selfServiceTokensRevoked: number;
  waitlistEntriesDeactivated: number;
}

export async function anonymizePatient(
  patientId: string,
  actor: AuditActor,
  ipAddress?: string | null,
): Promise<AnonymizePatientResult> {
  const transactionResult = await getPrisma().$transaction(async (tx) => {
    const anonymizedAt = new Date();

    // TOUR 2 [MAJEUR-4] — the claim itself IS the guard: this conditional
    // `updateMany` is the transaction's first write, and only the caller
    // whose `WHERE anonymizedAt IS NULL` actually matches the row may
    // proceed. See the module header comment for the full race-safety
    // argument (empirically disproven for the old findUnique-then-update
    // shape, now fixed without a migration or an isolation-level change).
    const claimed = await tx.patient.updateMany({
      where: { id: patientId, anonymizedAt: null },
      data: {
        firstName: "Patient",
        lastName: "anonymisé",
        phone: "",
        phoneE164: "",
        email: null,
        birthDate: null,
        notes: null,
        messagingOptOut: true,
        active: false,
        anonymizedAt,
      },
    });

    if (claimed.count === 0) {
      // We did NOT write — that part is already certain and atomic. This
      // follow-up read only decides which typed error to surface; it carries
      // no race requirement of its own.
      const stillExists = await tx.patient.findUnique({
        where: { id: patientId },
        select: { id: true },
      });
      if (!stillExists) {
        throw new PatientNotFoundError();
      }
      throw new PatientAlreadyAnonymizedError();
    }

    // updateMany's returned count is exactly "how many rows this patient
    // has", regardless of whether visitNotes/notes/treatment were already
    // null — no separate count() query needed.
    const appointments = await tx.appointment.updateMany({
      where: { patientId },
      data: { visitNotes: null },
    });
    const visits = await tx.visit.updateMany({
      where: { patientId },
      data: { notes: null, treatment: null },
    });
    // task-13.md §Exigences point 4 — neutralize, never delete, so
    // send-volume statistics stay exact. `error` cleared too (TOUR 2
    // [MAJEUR-2]) — a real SMS gateway's rejection message routinely echoes
    // the recipient number back.
    const smsMessages = await tx.smsMessage.updateMany({
      where: { patientId },
      data: { to: "", body: "", error: null },
    });
    // TOUR 2 [MAJEUR-1] — revoke every live token so a shared-phone viewer
    // (or anyone else who saw the SMS link) loses access the moment erasure
    // happens, not just when the token would have expired on its own.
    const selfServiceTokens = await tx.selfServiceToken.updateMany({
      where: { appointment: { patientId }, revokedAt: null },
      data: { revokedAt: anonymizedAt },
    });
    // TOUR 2 [MAJEUR-3] — deactivate any waitlist entry and drop the
    // requested dates; `serviceId` alone (kept, like the Appointment/Visit
    // shells) is not identifying on its own.
    const waitlistEntries = await tx.waitlistEntry.updateMany({
      where: { patientId, active: true },
      data: { active: false, preferredDates: [] },
    });

    return {
      anonymizedAt,
      appointmentsKept: appointments.count,
      visitsKept: visits.count,
      smsMessagesScrubbed: smsMessages.count,
      selfServiceTokensRevoked: selfServiceTokens.count,
      waitlistEntriesDeactivated: waitlistEntries.count,
    };
  });

  await logAction(
    actor,
    AuditAction.PATIENT_ANONYMIZED,
    "Patient",
    patientId,
    {
      appointmentsKept: transactionResult.appointmentsKept,
      visitsKept: transactionResult.visitsKept,
      smsMessagesScrubbed: transactionResult.smsMessagesScrubbed,
      selfServiceTokensRevoked: transactionResult.selfServiceTokensRevoked,
      waitlistEntriesDeactivated: transactionResult.waitlistEntriesDeactivated,
    },
    ipAddress,
  );

  return { id: patientId, ...transactionResult };
}
