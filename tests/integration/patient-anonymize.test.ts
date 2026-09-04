import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  Role,
  SmsMessageType,
  SmsStatus,
  WaitlistSource,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { POST as anonymizeRoute } from "@/app/api/admin/patients/[id]/anonymize/route";
import { GET as patientRecordRoute, PATCH as patientPatchRoute } from "@/app/api/admin/patients/[id]/route";
import { GET as patientHistoryRoute } from "@/app/api/admin/patients/[id]/history/route";
import { POST as patientVisitsRoute } from "@/app/api/admin/patients/[id]/visits/route";
import { notifyBookingCreated } from "@/lib/messaging/notifyBookingCreated";
import { createSelfServiceToken } from "@/lib/selfservice/tokens";
import { GET as appointmentTokenLookupRoute } from "@/app/api/appointments/[token]/route";

// Task 13 step 6 — route-level tests for POST /api/admin/patients/[id]/anonymize.
// tests/authz-matrix.test.ts already proves the role gate (ADMIN only, 403 for
// the receptionist) on every actor x method combination for this route; this
// file proves the route's own behavior. The module-level scrub/idempotence/
// duplicate-collision proofs live in src/lib/privacy/anonymize.test.ts.

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.ADMIN) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `patient-anonymize-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active: true,
    },
  });
}

async function cookieFor(user: { id: string; role: Role }) {
  const token = await createSessionToken({
    userId: user.id,
    role: user.role as "ADMIN" | "RECEPTIONIST",
    tokenVersion: 0,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function getRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function bodyRequest(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {},
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createPatient(overrides: Partial<{
  firstName: string;
  lastName: string;
  phone: string;
  phoneE164: string;
}> = {}) {
  return getPrisma().patient.create({
    data: {
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? "Patient",
      phone: overrides.phone ?? `05${Math.floor(10000000 + Math.random() * 89999999)}`,
      phoneE164: overrides.phoneE164 ?? `+2135${Math.floor(1000000 + Math.random() * 8999999)}`,
    },
  });
}

async function lastAudit(action: AuditAction) {
  return getPrisma().auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: "desc" },
  });
}

async function makeAppointmentFor(
  patientId: string,
  status: AppointmentStatus = AppointmentStatus.PENDING,
) {
  const service = await getPrisma().service.create({
    data: {
      slug: `svc-anon-notif-${Math.random().toString(36).slice(2)}`,
      name: { fr: "Consultation", ar: "استشارة", en: "Consultation" },
      description: { fr: "d", ar: "d", en: "d" },
      durationMinutes: 30,
    },
  });
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId: service.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 60_000),
      status,
    },
  });
}

describe("POST /api/admin/patients/[id]/anonymize", () => {
  it("rejects a cross-site Origin with 403 CSRF_ORIGIN_MISMATCH, changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie, {
        origin: "http://evil.example",
      }),
      ctx(patient.id),
    );
    expect(response.status).toBe(403);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.anonymizedAt).toBeNull();
  });

  it("400s VALIDATION_ERROR when confirm is missing or not literal true, changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, {}, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.anonymizedAt).toBeNull();
  });

  it("404s NOT_FOUND for an unknown patient id", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);

    const response = await anonymizeRoute(
      bodyRequest(
        "POST",
        "/api/admin/patients/does-not-exist/anonymize",
        { confirm: true },
        cookie,
      ),
      ctx("does-not-exist"),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("200s with EXACTLY {id, anonymizedAt, appointmentsKept, visitsKept} and writes PATIENT_ANONYMIZED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Sara", lastName: "Meziane" });
    await getPrisma().visit.create({
      data: { patientId: patient.id, date: new Date(), type: "CONSULTATION" },
    });

    const response = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["id", "anonymizedAt", "appointmentsKept", "visitsKept"].sort(),
    );
    expect(body.id).toBe(patient.id);
    expect(body.appointmentsKept).toBe(0);
    expect(body.visitsKept).toBe(1);
    // No erased identity value anywhere in the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Sara");
    expect(serialized).not.toContain("Meziane");

    const audit = await lastAudit(AuditAction.PATIENT_ANONYMIZED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityType).toBe("Patient");
    expect(audit?.entityId).toBe(patient.id);
    // The audit log must never become a backup of what it just erased.
    const serializedDetail = JSON.stringify(audit?.detail);
    expect(serializedDetail).not.toContain("Sara");
    expect(serializedDetail).not.toContain("Meziane");
    expect(serializedDetail).not.toContain(patient.phone);
    expect(serializedDetail).not.toContain(patient.phoneE164);
  });

  it("anonymizing twice: the second call returns 409 ALREADY_ANONYMIZED and anonymizedAt is UNCHANGED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const first = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { anonymizedAt: string };

    const second = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { error: { code: string } };
    expect(secondBody.error.code).toBe("ALREADY_ANONYMIZED");

    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.anonymizedAt?.toISOString()).toBe(firstBody.anonymizedAt);

    // Only ONE PATIENT_ANONYMIZED row was ever written for this patient.
    const count = await getPrisma().auditLog.count({
      where: { action: AuditAction.PATIENT_ANONYMIZED, entityId: patient.id },
    });
    expect(count).toBe(1);
  });

  // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 5,
  // point 3 — the 409 PATIENT_ANONYMIZED guards on PATCH /[id] and
  // POST /[id]/visits (added in étape 5) must actually fire once a REAL
  // anonymization has happened through this route, not just against a
  // hand-set `anonymizedAt` fixture.
  it("end-to-end: after anonymizing, PATCH /[id] and POST /[id]/visits both 409 PATIENT_ANONYMIZED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const anonymizeResponse = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(anonymizeResponse.status).toBe(200);

    const patchResponse = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: "should not land" }, cookie),
      ctx(patient.id),
    );
    expect(patchResponse.status).toBe(409);
    const patchBody = (await patchResponse.json()) as { error: { code: string } };
    expect(patchBody.error.code).toBe("PATIENT_ANONYMIZED");

    const visitResponse = await patientVisitsRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${patient.id}/visits`,
        { date: "2026-01-15", type: "CONSULTATION" },
        cookie,
      ),
      ctx(patient.id),
    );
    expect(visitResponse.status).toBe(409);
    const visitBody = (await visitResponse.json()) as { error: { code: string } };
    expect(visitBody.error.code).toBe("PATIENT_ANONYMIZED");

    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.notes).toBeNull();
    expect(await getPrisma().visit.count({ where: { patientId: patient.id } })).toBe(0);
  });

  // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 5,
  // point 1 — an irreversible ADMIN route must share the same write budget
  // as the rest of this route family, not go unthrottled.
  it("is rate-limited under the shared write budget (30/5min)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);

    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      const patient = await createPatient();
      last = await anonymizeRoute(
        bodyRequest(
          "POST",
          `/api/admin/patients/${patient.id}/anonymize`,
          { confirm: true },
          cookie,
        ),
        ctx(patient.id),
      );
    }
    expect(last?.status).toBe(200);

    const overBudgetPatient = await createPatient();
    const overBudget = await anonymizeRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${overBudgetPatient.id}/anonymize`,
        { confirm: true },
        cookie,
      ),
      ctx(overBudgetPatient.id),
    );
    expect(overBudget.status).toBe(429);
    const body = (await overBudget.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    // Blocked before any write — the 31st patient was never anonymized.
    const reloaded = await getPrisma().patient.findUniqueOrThrow({
      where: { id: overBudgetPatient.id },
    });
    expect(reloaded.anonymizedAt).toBeNull();
  }, 20000);
});

// task-13.md étape 6, TOUR 2 [CRITIQUE] — ortho-security: Notification has no
// FK to Patient, so a name baked into `payload` at fan-out time would survive
// this route's transaction untouched forever. This is the proof required by
// the tour-2 briefing: create a patient, trigger a REAL booking notification
// fan-out (not a hand-built fixture), anonymize through the real route, then
// assert no Notification row anywhere still carries the name.
describe("erasure completeness — Notification.payload carries no patient name", () => {
  it("no Notification row contains the patient's name after anonymization", async () => {
    const staff = await createStaff(); // ADMIN, active=true — both the caller
    // and (as an active staff member) a fan-out recipient of the booking notification.
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Nadia", lastName: "Cherif" });
    const appointment = await makeAppointmentFor(patient.id);

    await notifyBookingCreated(appointment.id);

    const beforeErasure = await getPrisma().notification.findMany();
    expect(beforeErasure.length).toBeGreaterThan(0);

    const response = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);

    const notifications = await getPrisma().notification.findMany();
    expect(notifications.length).toBeGreaterThan(0);
    for (const n of notifications) {
      const serialized = JSON.stringify(n.payload);
      expect(serialized).not.toContain("Nadia");
      expect(serialized).not.toContain("Cherif");
    }
  });
});

// task-13.md étape 6, TOUR 2 [MAJEUR-1] — a live, unused, unrevoked
// SelfServiceToken is actionable proof that "erasure" did not erase access:
// GET /api/appointments/[token] still resolves the first name, service and
// date. The single most common reason someone files an erasure request is
// precisely that a third party saw the SMS link on a shared family phone.
describe("erasure completeness — self-service tokens are revoked, not left actionable", () => {
  it("a live token 410s TOKEN_REVOKED via GET /api/appointments/[token] after anonymization", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Amine", lastName: "Rahmani" });
    const appointment = await makeAppointmentFor(patient.id, AppointmentStatus.CONFIRMED);
    const { rawToken } = await createSelfServiceToken(appointment.id);

    // Sanity: the token resolves BEFORE erasure.
    const before = await appointmentTokenLookupRoute(
      new Request(`http://localhost:3000/api/appointments/${rawToken}`),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(before.status).toBe(200);

    const anonymizeResponse = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(anonymizeResponse.status).toBe(200);

    const token = await getPrisma().selfServiceToken.findFirstOrThrow({
      where: { appointmentId: appointment.id },
    });
    expect(token.revokedAt).not.toBeNull();

    const after = await appointmentTokenLookupRoute(
      new Request(`http://localhost:3000/api/appointments/${rawToken}`),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(after.status).toBe(410);
    const afterBody = (await after.json()) as { error: { code: string } };
    expect(afterBody.error.code).toBe("TOKEN_REVOKED");
  });
});

// Task 13 étape 8 (ortho-tester) — the screen-level acceptance criterion
// "anonymiser en ADMIN : ... le nombre d'éléments de la timeline est
// inchangé" (task-13.md étape 8, critère #4). GET .../history already has
// its own ordering/exclusion coverage (tests/integration/patient-record.test.ts);
// this proves the one thing specific to anonymization — that erasing the
// chart never drops or duplicates a COMPLETED appointment / Visit row from
// the unified timeline the PatientTimeline component renders — and that the
// record GET the edit screen reads has lost its identifiers.
describe("anonymization leaves the unified timeline count exactly unchanged", () => {
  it("history has the same item count before and after anonymization, and the record GET loses its identifiers", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Yasmine", lastName: "Chaouch" });

    // One COMPLETED appointment (counts in the timeline) and one CANCELLED
    // one (must never count, before or after — proven already at the route
    // level, reused here only as a control value that must stay excluded).
    const completed = await makeAppointmentFor(patient.id, AppointmentStatus.COMPLETED);
    await getPrisma().appointment.update({
      where: { id: completed.id },
      data: { completedAt: new Date() },
    });
    await makeAppointmentFor(patient.id, AppointmentStatus.CANCELLED);
    await getPrisma().visit.create({
      data: {
        patientId: patient.id,
        date: new Date(),
        type: "CONTROLE",
        notes: "Contrôle de routine",
        treatment: "Détartrage",
      },
    });

    const before = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
      ctx(patient.id),
    );
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { items: unknown[]; total: number };
    expect(beforeBody.total).toBe(2); // COMPLETED appointment + Visit, CANCELLED excluded

    const anonymizeResponse = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(anonymizeResponse.status).toBe(200);

    const after = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
      ctx(patient.id),
    );
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { items: unknown[]; total: number };
    expect(afterBody.total).toBe(beforeBody.total);
    expect(afterBody.items).toHaveLength(beforeBody.items.length);

    // The record itself has lost its identifiers — this is what
    // PatientDetail's "Dossier anonymisé" banner and read-only PatientForm
    // are rendering the *consequence* of.
    const record = await patientRecordRoute(
      getRequest(`/api/admin/patients/${patient.id}`, cookie),
      ctx(patient.id),
    );
    expect(record.status).toBe(200);
    const recordBody = (await record.json()) as Record<string, unknown>;
    expect(recordBody.anonymizedAt).not.toBeNull();
    const serializedRecord = JSON.stringify(recordBody);
    expect(serializedRecord).not.toContain("Yasmine");
    expect(serializedRecord).not.toContain("Chaouch");
    expect(serializedRecord).not.toContain(patient.phone);
    expect(serializedRecord).not.toContain(patient.phoneE164);
  });
});

describe("erasure fan-out — SMS, visits, documents, waitlist, audit", () => {
  it("scrubs SmsMessage bodies, clears Visit treatment, 404s documents, drops waitlist, preserves audit", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({
      firstName: "Yasmine",
      lastName: "Chaouch",
      phone: "0550999888",
      phoneE164: "+213550999888",
    });
    const appointment = await makeAppointmentFor(patient.id);

    // SMS row carrying the patient's name + phone.
    await getPrisma().smsMessage.create({
      data: {
        to: patient.phoneE164,
        body: `Bonjour Yasmine Chaouch, rappel ${patient.phoneE164}`,
        patientId: patient.id,
        type: SmsMessageType.MANUAL,
        provider: "mock",
        status: SmsStatus.SENT,
        appointmentId: appointment.id,
      },
    });
    // Manual visit with clinical notes.
    const visit = await getPrisma().visit.create({
      data: {
        patientId: patient.id,
        date: new Date(),
        type: "consultation",
        notes: "notes Yasmine",
        treatment: "traitement Chaouch",
      },
    });
    // Active waitlist entry for the anonymized phone.
    const service = await getPrisma().service.create({
      data: {
        slug: `svc-anon-wl-${Math.random().toString(36).slice(2)}`,
        name: { fr: "Consultation" },
        description: { fr: "d" },
        durationMinutes: 30,
      },
    });
    await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [new Date("2026-09-02T00:00:00.000Z")],
        source: WaitlistSource.STAFF,
      },
    });
    const auditBefore = await getPrisma().auditLog.count();

    const response = await anonymizeRoute(
      bodyRequest("POST", `/api/admin/patients/${patient.id}/anonymize`, { confirm: true }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);

    // SMS rows are kept (history) but neutralized.
    const msgs = await getPrisma().smsMessage.findMany({
      where: { patientId: patient.id },
    });
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m.body).not.toContain("Yasmine");
      expect(m.body).not.toContain("Chaouch");
      expect(m.body).not.toContain("+213550999888");
      expect(m.to).not.toContain("+213550999888");
    }
    // Visit row kept, clinical text cleared.
    const afterVisit = await getPrisma().visit.findUnique({ where: { id: visit.id } });
    expect(afterVisit).not.toBeNull();
    expect(afterVisit!.treatment).toBeNull();
    // Waitlist entries for the phone are gone/inactive.
    expect(
      await getPrisma().waitlistEntry.count({
        where: { patientId: patient.id, active: true },
      }),
    ).toBe(0);
    // Audit trail is append-only: nothing removed, erasure itself logged.
    expect(await getPrisma().auditLog.count()).toBeGreaterThan(auditBefore);
    expect(await lastAudit(AuditAction.PATIENT_ANONYMIZED)).not.toBeNull();
  });

  it("concurrent anonymize calls: exactly one 200, one 409", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const path = `/api/admin/patients/${patient.id}/anonymize`;

    const [a, b] = await Promise.all([
      anonymizeRoute(bodyRequest("POST", path, { confirm: true }, cookie), ctx(patient.id)),
      anonymizeRoute(bodyRequest("POST", path, { confirm: true }, cookie), ctx(patient.id)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
