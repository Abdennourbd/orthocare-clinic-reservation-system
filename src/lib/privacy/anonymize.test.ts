import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  SmsMessageType,
  SmsStatus,
  WaitlistSource,
} from "@/generated/prisma/client";
import { anonymizePatient, PatientAlreadyAnonymizedError } from "./anonymize";
import { findDuplicateCandidates, normalizeName } from "@/lib/patients/duplicates";
import { visitTypeValues } from "@/schemas/patient";

// Task 13 step 6 — unit tests for the module directly (no HTTP layer).
// Colocated with the module per CLAUDE.md. The route-level 403/400/404
// wiring lives in tests/integration/patient-anonymize.test.ts.

async function createPatient(overrides: Partial<{
  firstName: string;
  lastName: string;
  phone: string;
  phoneE164: string;
  email: string | null;
  notes: string | null;
  birthDate: Date;
}> = {}) {
  const firstName = overrides.firstName ?? "Test";
  const lastName = overrides.lastName ?? "Patient";
  return getPrisma().patient.create({
    data: {
      firstName,
      lastName,
      // Task 13 étape 9b (ortho-security MINEUR-1, étape 9a Journal) — every
      // fixture that creates a Patient directly must populate these two
      // columns, same precedent as phoneE164 below. Left NULL, the erasure
      // test's "no trace survives" assertions (JSON.stringify(...).not.toContain)
      // would pass even if anonymizePatient() never touched the columns at
      // all — a NULL row already contains no trace of anything.
      firstNameNormalized: normalizeName(firstName),
      lastNameNormalized: normalizeName(lastName),
      phone: overrides.phone ?? `05${Math.floor(10000000 + Math.random() * 89999999)}`,
      phoneE164: overrides.phoneE164 ?? `+2135${Math.floor(1000000 + Math.random() * 8999999)}`,
      email: overrides.email,
      notes: overrides.notes,
      birthDate: overrides.birthDate,
    },
  });
}

async function seedService() {
  return getPrisma().service.create({
    data: {
      slug: `svc-anonymize-${Math.random().toString(36).slice(2)}`,
      name: { fr: "Détartrage", ar: "تنظيف", en: "Scaling" },
      description: { fr: "d", ar: "d", en: "d" },
      durationMinutes: 30,
    },
  });
}

describe("anonymizePatient — the central test required by tasks/todo.md", () => {
  it("scrubs identity/notes/SMS but KEEPS 3 appointments and 2 visits as shells", async () => {
    const secretPhone = "0550999888";
    const secretPhoneE164 = "+213550999888";
    const patient = await createPatient({
      firstName: "Yacine",
      lastName: "Bouzid",
      phone: secretPhone,
      phoneE164: secretPhoneE164,
      email: "yacine@example.com",
      notes: "clinical note marker",
      birthDate: new Date("1990-05-01"),
    });
    const service = await seedService();

    let firstAppointmentId = "";
    for (let i = 0; i < 3; i++) {
      const appointment = await getPrisma().appointment.create({
        data: {
          patientId: patient.id,
          serviceId: service.id,
          startTime: new Date(Date.now() - i * 86_400_000),
          endTime: new Date(Date.now() - i * 86_400_000 + 30 * 60_000),
          status: AppointmentStatus.COMPLETED,
          completedAt: new Date(),
          visitNotes: `appointment note ${i} — ${patient.firstName}`,
        },
      });
      if (i === 0) firstAppointmentId = appointment.id;
    }
    for (let i = 0; i < 2; i++) {
      await getPrisma().visit.create({
        data: {
          patientId: patient.id,
          date: new Date(),
          type: "CONSULTATION",
          notes: `visit note ${i} — ${patient.lastName}`,
          treatment: `treatment ${i} — ${secretPhone}`,
        },
      });
    }
    await getPrisma().smsMessage.create({
      data: {
        to: secretPhoneE164,
        body: `Bonjour ${patient.firstName}, votre RDV est confirmé.`,
        patientId: patient.id,
        type: SmsMessageType.CONFIRMATION,
        provider: "mock",
        status: SmsStatus.SENT,
        sentAt: new Date(),
        // TOUR 2 [MAJEUR-2] fixture — a real gateway's rejection message
        // routinely echoes the recipient number back.
        error: `Gateway rejected ${secretPhoneE164}: invalid destination`,
      },
    });
    // TOUR 2 [MAJEUR-1] fixture — a live, unused, unrevoked token.
    const tokenHash = createHash("sha256").update(randomBytes(16)).digest("hex");
    const token = await getPrisma().selfServiceToken.create({
      data: {
        tokenHash,
        appointmentId: firstAppointmentId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    // TOUR 2 [MAJEUR-3] fixture — a live waitlist entry with dates/service.
    const waitlistEntry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [new Date(Date.now() + 5 * 86_400_000)],
        source: WaitlistSource.PATIENT,
      },
    });

    const result = await anonymizePatient(patient.id, { type: AuditActorType.STAFF, userId: undefined });

    expect(result.appointmentsKept).toBe(3);
    expect(result.visitsKept).toBe(2);
    expect(result.smsMessagesScrubbed).toBe(1);
    expect(result.selfServiceTokensRevoked).toBe(1);
    expect(result.waitlistEntriesDeactivated).toBe(1);

    // Counters/shells — rows still exist, in the exact same quantity.
    expect(await getPrisma().appointment.count({ where: { patientId: patient.id } })).toBe(3);
    expect(await getPrisma().visit.count({ where: { patientId: patient.id } })).toBe(2);

    const reloadedPatient = await getPrisma().patient.findUniqueOrThrow({
      where: { id: patient.id },
    });
    expect(reloadedPatient.firstName).toBe("Patient");
    expect(reloadedPatient.lastName).toBe("anonymisé");
    expect(reloadedPatient.phone).toBe("");
    expect(reloadedPatient.phoneE164).toBe("");
    expect(reloadedPatient.email).toBeNull();
    expect(reloadedPatient.birthDate).toBeNull();
    expect(reloadedPatient.notes).toBeNull();
    expect(reloadedPatient.messagingOptOut).toBe(true);
    expect(reloadedPatient.active).toBe(false);
    expect(reloadedPatient.anonymizedAt).not.toBeNull();

    const appointments = await getPrisma().appointment.findMany({
      where: { patientId: patient.id },
    });
    expect(appointments).toHaveLength(3);
    for (const a of appointments) {
      expect(a.visitNotes).toBeNull();
      // Shell kept: id, dates, serviceId, status all still present.
      expect(a.status).toBe(AppointmentStatus.COMPLETED);
      expect(a.serviceId).toBe(service.id);
    }

    const visits = await getPrisma().visit.findMany({ where: { patientId: patient.id } });
    expect(visits).toHaveLength(2);
    for (const v of visits) {
      expect(v.notes).toBeNull();
      expect(v.treatment).toBeNull();
      // Shell kept, and `type` is still one of the 5 values visitCreateSchema
      // allows — task-13.md étape 1 Journal [MAJEUR-2] dette: this is the
      // test that closes it. `type` is never re-written by anonymization, so
      // this also proves it was written through visitCreateSchema in the
      // first place, not free text.
      expect(visitTypeValues as readonly string[]).toContain(v.type);
    }

    // task-13.md §Exigences point 4 — SmsMessage rows are NEUTRALIZED, never
    // deleted: the row (and status/provider/sentAt/type) survives, only
    // `to`/`body` are blanked.
    const smsMessages = await getPrisma().smsMessage.findMany({
      where: { patientId: patient.id },
    });
    expect(smsMessages).toHaveLength(1);
    expect(smsMessages[0].to).toBe("");
    expect(smsMessages[0].body).toBe("");
    // TOUR 2 [MAJEUR-2] — `error` neutralized too; a real gateway's
    // rejection message routinely echoes the recipient number back.
    expect(smsMessages[0].error).toBeNull();
    expect(smsMessages[0].status).toBe(SmsStatus.SENT);
    expect(smsMessages[0].provider).toBe("mock");
    expect(smsMessages[0].sentAt).not.toBeNull();
    // No lingering copy of the erased phone/name anywhere on the row.
    const serializedSms = JSON.stringify(smsMessages[0]);
    expect(serializedSms).not.toContain(secretPhoneE164);
    expect(serializedSms).not.toContain("Yacine");

    // TOUR 2 [MAJEUR-1] — the live token is revoked, not left actionable.
    const reloadedToken = await getPrisma().selfServiceToken.findUniqueOrThrow({
      where: { id: token.id },
    });
    expect(reloadedToken.revokedAt).not.toBeNull();
    expect(reloadedToken.revokedAt?.getTime()).toBe(
      reloadedPatient.anonymizedAt?.getTime(),
    );

    // TOUR 2 [MAJEUR-3] — the waitlist entry is deactivated and its
    // requested dates cleared; `serviceId` alone (kept) is not identifying.
    const reloadedWaitlistEntry = await getPrisma().waitlistEntry.findUniqueOrThrow({
      where: { id: waitlistEntry.id },
    });
    expect(reloadedWaitlistEntry.active).toBe(false);
    expect(reloadedWaitlistEntry.preferredDates).toEqual([]);
    expect(reloadedWaitlistEntry.serviceId).toBe(service.id);

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.PATIENT_ANONYMIZED, entityId: patient.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    const detail = audit?.detail as {
      appointmentsKept: number;
      visitsKept: number;
      smsMessagesScrubbed: number;
      selfServiceTokensRevoked: number;
      waitlistEntriesDeactivated: number;
    };
    expect(detail).toEqual({
      appointmentsKept: 3,
      visitsKept: 2,
      smsMessagesScrubbed: 1,
      selfServiceTokensRevoked: 1,
      waitlistEntriesDeactivated: 1,
    });
    // The audit log must never become a backup of what was just erased.
    const serializedDetail = JSON.stringify(audit?.detail);
    expect(serializedDetail).not.toContain("Yacine");
    expect(serializedDetail).not.toContain("Bouzid");
    expect(serializedDetail).not.toContain(secretPhone);
    expect(serializedDetail).not.toContain(secretPhoneE164);
    expect(serializedDetail).not.toContain("yacine@example.com");
    expect(serializedDetail).not.toContain("clinical note marker");
  });
});

describe("anonymizePatient — idempotence", () => {
  it("a second call throws PatientAlreadyAnonymizedError and leaves anonymizedAt UNCHANGED", async () => {
    const patient = await createPatient();
    const first = await anonymizePatient(patient.id, { type: AuditActorType.STAFF });
    const firstAnonymizedAt = first.anonymizedAt;

    await expect(
      anonymizePatient(patient.id, { type: AuditActorType.STAFF }),
    ).rejects.toBeInstanceOf(PatientAlreadyAnonymizedError);

    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.anonymizedAt?.getTime()).toBe(firstAnonymizedAt.getTime());

    // Idempotent means no second audit row either — the transaction bails
    // out before any write, so logAction() (called only after commit) is
    // never reached the second time.
    const count = await getPrisma().auditLog.count({
      where: { action: AuditAction.PATIENT_ANONYMIZED, entityId: patient.id },
    });
    expect(count).toBe(1);
  });
});

// TOUR 2 [MAJEUR-4] — proves the claim-based guard is REAL mutual exclusion,
// not just a read-then-write check that happens to look race-safe. Fires two
// genuinely concurrent anonymizePatient() calls on the SAME patient (no
// await between them — both start before either can finish) and asserts
// exactly one wins, the loser gets PatientAlreadyAnonymizedError, and only
// ONE PATIENT_ANONYMIZED audit row / stamped anonymizedAt exists afterwards.
// ortho-security reproduced the old bug with two concurrent psql sessions
// (both `SELECT` NULL, both `UPDATE 1`); this test reproduces the same race
// at the application level and must fail against the pre-fix
// findUnique-then-update shape.
describe("anonymizePatient — concurrent calls are truly mutually exclusive", () => {
  it("two simultaneous anonymize calls on the same patient: exactly one wins, one PATIENT_ANONYMIZED audit row, anonymizedAt not re-stamped", async () => {
    const patient = await createPatient();

    const [a, b] = await Promise.allSettled([
      anonymizePatient(patient.id, { type: AuditActorType.STAFF }),
      anonymizePatient(patient.id, { type: AuditActorType.STAFF }),
    ]);

    const results = [a, b];
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof anonymizePatient>>> =>
        r.status === "fulfilled",
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    // Exactly one of the two calls actually anonymized the patient.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(PatientAlreadyAnonymizedError);

    const winnerAnonymizedAt = fulfilled[0].value.anonymizedAt;
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    // anonymizedAt was stamped exactly once — the loser never re-dated it.
    expect(reloaded.anonymizedAt?.getTime()).toBe(winnerAnonymizedAt.getTime());

    // The append-only audit log has exactly ONE row for this erasure — a
    // double PATIENT_ANONYMIZED row would be indelible proof of the bug.
    const count = await getPrisma().auditLog.count({
      where: { action: AuditAction.PATIENT_ANONYMIZED, entityId: patient.id },
    });
    expect(count).toBe(1);
  });
});

// Task 13 étape 9a, point 10 — the most important test of this step: erasure
// MUST scrub the two derived name-search columns too, or a name that a
// patient asked to be forgotten survives, hidden, and becomes re-searchable
// the moment étape 9b wires GET /api/admin/patients?q= onto them.
describe("anonymizePatient — erases the normalized-name search columns (Task 13 étape 9a)", () => {
  it("clears firstNameNormalized/lastNameNormalized to the empty sentinel — never normalizeName('Patient') — and no trace of the original normalized name survives anywhere on the row", async () => {
    const patient = await createPatient({ firstName: "Bénali", lastName: "Zerrouki" });
    const originalNormalizedFirst = normalizeName("Bénali");
    const originalNormalizedLast = normalizeName("Zerrouki");
    expect(originalNormalizedFirst).toBe("benali");

    await anonymizePatient(patient.id, { type: AuditActorType.STAFF });

    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.firstNameNormalized).toBe("");
    expect(reloaded.lastNameNormalized).toBe("");
    // Not the normalized form of the placeholder name either — "patient"
    // must never become a matchable search term as a side effect of erasure.
    expect(reloaded.firstNameNormalized).not.toBe(normalizeName("Patient"));

    // Same style as the SMS assertions above: the strongest form of the
    // check is that the original normalized name — and the original raw
    // name — appear NOWHERE in the reloaded row, not just absent from named
    // fields.
    const serialized = JSON.stringify(reloaded);
    expect(serialized).not.toContain(originalNormalizedFirst);
    expect(serialized).not.toContain(originalNormalizedLast);
    expect(serialized).not.toContain("Bénali");
    expect(serialized).not.toContain("Zerrouki");
  });
});

describe("anonymizePatient — two anonymized patients never collide as duplicates", () => {
  it("two anonymized patients sharing phoneE164 '' and identical placeholder names are NOT reported as each other's duplicate", async () => {
    const a = await createPatient({ firstName: "Karim", lastName: "One" });
    const b = await createPatient({ firstName: "Karim", lastName: "Two" });
    await anonymizePatient(a.id, { type: AuditActorType.STAFF });
    await anonymizePatient(b.id, { type: AuditActorType.STAFF });

    const reloadedA = await getPrisma().patient.findUniqueOrThrow({ where: { id: a.id } });
    expect(reloadedA.phoneE164).toBe("");
    expect(reloadedA.firstName).toBe("Patient");
    expect(reloadedA.lastName).toBe("anonymisé");

    const candidates = await findDuplicateCandidates({
      firstName: "Patient",
      lastName: "anonymisé",
      phone: "",
      excludeId: a.id,
    });
    expect(candidates.map((c) => c.id)).not.toContain(b.id);
    expect(candidates).toEqual([]);
  });
});
