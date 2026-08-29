import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  Role,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  GET as patientRecordRoute,
  PATCH as patientPatchRoute,
} from "@/app/api/admin/patients/[id]/route";
import { GET as patientHistoryRoute } from "@/app/api/admin/patients/[id]/history/route";
import { POST as patientVisitsRoute } from "@/app/api/admin/patients/[id]/visits/route";

// Task 13 step 5 — GET/PATCH /api/admin/patients/[id], GET .../history,
// POST .../visits. tests/authz-matrix.test.ts already proves the role gate
// on every actor x method combination for these 4 routes; this file proves
// each route's own behavior — the patient id lives in the URL, so this is
// the most exposed surface in the task (anti-IDOR gets its own test below).

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `patient-record-${Math.random().toString(36).slice(2)}@test.com`,
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
  method: "PATCH" | "POST",
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

describe("anti-IDOR — GET /api/admin/patients/[id]", () => {
  it("an anonymous call on a REAL, existing patient id returns 401 with a body byte-identical to a call on a nonexistent id", async () => {
    const patient = await createPatient({ firstName: "Karim", lastName: "Zitouni" });

    const realResponse = await patientRecordRoute(
      getRequest(`/api/admin/patients/${patient.id}`),
      ctx(patient.id),
    );
    const fakeResponse = await patientRecordRoute(
      getRequest("/api/admin/patients/does-not-exist"),
      ctx("does-not-exist"),
    );

    expect(realResponse.status).toBe(401);
    expect(fakeResponse.status).toBe(401);
    const realBody = await realResponse.json();
    const fakeBody = await fakeResponse.json();
    expect(realBody).toEqual(fakeBody);

    const serialized = JSON.stringify(realBody);
    expect(serialized).not.toContain(patient.id);
    expect(serialized).not.toContain("Karim");
    expect(serialized).not.toContain("Zitouni");
  });
});

describe("GET /api/admin/patients/[id]", () => {
  it("writes exactly one PATIENT_RECORD_VIEWED (actorType STAFF, correct userId, scope 'record')", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const before = await getPrisma().auditLog.count({
      where: { action: AuditAction.PATIENT_RECORD_VIEWED },
    });
    const response = await patientRecordRoute(
      getRequest(`/api/admin/patients/${patient.id}`, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const after = await getPrisma().auditLog.count({
      where: { action: AuditAction.PATIENT_RECORD_VIEWED },
    });
    expect(after).toBe(before + 1);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect((audit?.detail as { scope: string }).scope).toBe("record");
  });

  it("404s with a generic message for an unknown id, and never writes patient data into the error body", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const response = await patientRecordRoute(
      getRequest("/api/admin/patients/does-not-exist", cookie),
      ctx("does-not-exist"),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // ortho-tester, étape 5 verification — the fiche's acceptance criteria
  // never pin down the exact response shape at runtime (only the `select`
  // in the route file does, by construction). CLAUDE.md §Sensitive zones
  // requires the minimum-disclosure whitelist to be asserted explicitly,
  // not just implied by the code — this is the reference-example route the
  // rest of the task points back to, so it should hold itself to that bar.
  it("returns EXACTLY the whitelisted fields for the record view — nothing more", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientRecordRoute(
      getRequest(`/api/admin/patients/${patient.id}`, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        "id",
        "firstName",
        "lastName",
        "phone",
        "email",
        "birthDate",
        "notes",
        "active",
        "anonymizedAt",
        "consentAt",
        "consentVersion",
        "messagingOptOut",
        "whatsappOptIn",
        "preferredLocale",
        "createdAt",
        "updatedAt",
        "createdBy",
        "updatedBy",
      ].sort(),
    );
    // createdBy/updatedBy reduced to `name` only — never the raw FK id.
    expect(body.createdBy).toBeNull();
    expect(body.updatedBy).toBeNull();
  });
});

describe("PATCH /api/admin/patients/[id]", () => {
  it("rejects a cross-site Origin with 403 CSRF_ORIGIN_MISMATCH, changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: "x" }, cookie, {
        origin: "http://evil.example",
      }),
      ctx(patient.id),
    );
    expect(response.status).toBe(403);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.notes).toBeNull();
  });

  it("a note change writes PATIENT_UPDATED with changedFields=['notes'] and NEVER the note's value in detail", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const secretNote = "CLINICAL-NOTE-MARKER-7781";

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: secretNote }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);

    const audit = await lastAudit(AuditAction.PATIENT_UPDATED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    const detail = audit?.detail as { changedFields: string[] };
    expect(detail.changedFields).toEqual(["notes"]);
    expect(JSON.stringify(audit?.detail)).not.toContain(secretNote);

    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.notes).toBe(secretNote);
  });

  it("a receptionist sending {active:false} gets 403, and the record stays active:true in the DB", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { active: false }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(403);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.active).toBe(true);
  });

  it("an admin sending {active:false} gets 200, and the record becomes active:false in the DB", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { active: false }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.active).toBe(false);
  });

  it("rejects a phone that does not normalize with 422 INVALID_PHONE, before any write", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { phone: "not-a-phone" }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_PHONE");
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.phone).toBe(patient.phone);
  });

  // Task 13 étape 5 (§Contraintes obligatoires issues de l'audit de l'étape
  // 4, point 3) — the PATCH must replay BOTH duplicate gates with
  // excludeId, otherwise an edit reopens exactly the hole POST's creation
  // gates close.
  it("replays the NAME duplicate gate: renaming into a homonym without acknowledgement returns 409 and changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await createPatient({ firstName: "Sami", lastName: "Kaci" });
    const target = await createPatient({ firstName: "Other", lastName: "Name" });

    const response = await patientPatchRoute(
      bodyRequest(
        "PATCH",
        `/api/admin/patients/${target.id}`,
        { firstName: "Sami", lastName: "Kaci" },
        cookie,
      ),
      ctx(target.id),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DUPLICATE_CANDIDATES");
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: target.id } });
    expect(reloaded.firstName).toBe("Other");
    expect(reloaded.lastName).toBe("Name");
  });

  it("replays the PHONE duplicate gate: changing phone to one already registered without acknowledgement returns 409 and changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const other = await createPatient({
      firstName: "PhoneOwner",
      lastName: "Existing",
      phone: "0550200050",
      phoneE164: "+213550200050",
    });
    const target = await createPatient({
      firstName: "PhoneChanger",
      lastName: "Target",
      phone: "0550200051",
      phoneE164: "+213550200051",
    });

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${target.id}`, { phone: "0550200050" }, cookie),
      ctx(target.id),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PHONE_ALREADY_REGISTERED");
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: target.id } });
    expect(reloaded.phoneE164).toBe("+213550200051");
    // Existing record, only a NAME target — untouched.
    const reloadedOther = await getPrisma().patient.findUniqueOrThrow({ where: { id: other.id } });
    expect(reloadedOther.phoneE164).toBe("+213550200050");
  });

  it("with duplicateAcknowledged: true, the same homonym rename succeeds (200)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await createPatient({ firstName: "Warda", lastName: "Sahraoui" });
    const target = await createPatient({ firstName: "Other2", lastName: "Name2" });

    const response = await patientPatchRoute(
      bodyRequest(
        "PATCH",
        `/api/admin/patients/${target.id}`,
        { firstName: "Warda", lastName: "Sahraoui", duplicateAcknowledged: true },
        cookie,
      ),
      ctx(target.id),
    );
    expect(response.status).toBe(200);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: target.id } });
    expect(reloaded.firstName).toBe("Warda");
  });

  // Task 13 étape 5 tour 2, BLOQUANT (ortho-security) — derived from "replays
  // the PHONE duplicate gate" above, but the target is a PRE-EXISTING
  // homonym of the phone's owner (the "father and son share a name, two
  // distinct charts" scenario from the audit finding). Editing ONLY the
  // phone field means `nameChanged` is false, so the old code never
  // evaluated the NAME gate — acknowledging `phoneSharingAcknowledged` alone
  // was enough to make the two charts share BOTH name and phone, and
  // therefore become indistinguishable to upsertPatient()'s phone+name
  // resolution. This test is RED on the pre-fix code (200, phone silently
  // changed) and GREEN after the fix (409 INDISTINGUISHABLE_RECORDS,
  // nothing written) — see this step's Journal for the red-run proof.
  it("changing phone onto a PRE-EXISTING HOMONYM's number requires BOTH acknowledgements, not phoneSharingAcknowledged alone — the pair would otherwise become indistinguishable", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const owner = await createPatient({
      firstName: "Homonym",
      lastName: "Case",
      phone: "0550300060",
      phoneE164: "+213550300060",
    });
    const target = await createPatient({
      // Same normalized name as `owner` ALREADY, before this edit — a
      // legitimate pre-existing homonymy (father/son), not something this
      // request creates.
      firstName: "Homonym",
      lastName: "Case",
      phone: "0550300061",
      phoneE164: "+213550300061",
    });

    const response = await patientPatchRoute(
      bodyRequest(
        "PATCH",
        `/api/admin/patients/${target.id}`,
        {
          phone: "0550300060",
          phoneSharingAcknowledged: true,
          // duplicateAcknowledged intentionally OMITTED — the NAME half of
          // the consequence was never acknowledged.
        },
        cookie,
      ),
      ctx(target.id),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INDISTINGUISHABLE_RECORDS");

    const reloadedTarget = await getPrisma().patient.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(reloadedTarget.phoneE164).toBe("+213550300061");
    const reloadedOwner = await getPrisma().patient.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(reloadedOwner.phoneE164).toBe("+213550300060");
  });

  it("the same homonym+phone edit succeeds (200) once BOTH acknowledgements are given", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await createPatient({
      firstName: "Homonym2",
      lastName: "Case2",
      phone: "0550300070",
      phoneE164: "+213550300070",
    });
    const target = await createPatient({
      firstName: "Homonym2",
      lastName: "Case2",
      phone: "0550300071",
      phoneE164: "+213550300071",
    });

    const response = await patientPatchRoute(
      bodyRequest(
        "PATCH",
        `/api/admin/patients/${target.id}`,
        {
          phone: "0550300070",
          duplicateAcknowledged: true,
          phoneSharingAcknowledged: true,
        },
        cookie,
      ),
      ctx(target.id),
    );

    expect(response.status).toBe(200);
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: target.id } });
    expect(reloaded.phoneE164).toBe("+213550300070");
  });

  // Task 13 étape 5 tour 2, MAJEUR-2 (ortho-security) — an anonymized chart
  // must never be writable again from this screen.
  it("PATCH on an anonymized patient returns 409 PATIENT_ANONYMIZED and changes nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { anonymizedAt: new Date() },
    });

    const response = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: "should not land" }, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PATIENT_ANONYMIZED");
    const reloaded = await getPrisma().patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(reloaded.notes).toBeNull();
  });

  // Task 13 étape 5 tour 2, MINEUR-1 (ortho-security) — the audit detail must
  // say the DIRECTION of the change on the one destructive-looking operation
  // on this screen, not just that `active` was among the changed fields.
  it("deactivating writes detail.active === false, and reactivating writes detail.active === true", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient();

    const off = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { active: false }, cookie),
      ctx(patient.id),
    );
    expect(off.status).toBe(200);
    const offAudit = await lastAudit(AuditAction.PATIENT_UPDATED);
    expect((offAudit?.detail as { active?: boolean }).active).toBe(false);

    const on = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { active: true }, cookie),
      ctx(patient.id),
    );
    expect(on.status).toBe(200);
    const onAudit = await lastAudit(AuditAction.PATIENT_UPDATED);
    expect((onAudit?.detail as { active?: boolean }).active).toBe(true);
  });

  // Task 13 étape 5 tour 2, MAJEUR-1 (ortho-security) — PATCH must share the
  // same write budget as POST /api/admin/patients
  // (`staff:<userId>:patients-write`, 30/5min), not go unthrottled.
  it("is rate-limited under the shared write budget (30/5min)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      last = await patientPatchRoute(
        bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: `n${i}` }, cookie),
        ctx(patient.id),
      );
    }
    expect(last?.status).toBe(200);

    const overBudget = await patientPatchRoute(
      bodyRequest("PATCH", `/api/admin/patients/${patient.id}`, { notes: "over" }, cookie),
      ctx(patient.id),
    );
    expect(overBudget.status).toBe(429);
    const body = (await overBudget.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 20000);
});

describe("GET /api/admin/patients/[id]/history", () => {
  async function seedService() {
    return getPrisma().service.create({
      data: {
        slug: `svc-history-${Math.random().toString(36).slice(2)}`,
        name: { fr: "Détartrage", ar: "تنظيف", en: "Scaling" },
        description: { fr: "d", ar: "d", en: "d" },
        durationMinutes: 30,
      },
    });
  }

  it("unifies COMPLETED appointments and Visit rows, EXCLUDES CANCELLED, sorted newest first", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const service = await seedService();
    const now = Date.now();
    const day = 24 * 3600 * 1000;

    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: new Date(now - 5 * day),
        endTime: new Date(now - 5 * day + 30 * 60_000),
        status: AppointmentStatus.COMPLETED,
        completedAt: new Date(now - 5 * day),
      },
    });
    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: new Date(now - 3 * day),
        endTime: new Date(now - 3 * day + 30 * 60_000),
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(now - 3 * day),
      },
    });
    await getPrisma().visit.create({
      data: { patientId: patient.id, date: new Date(now - 10 * day), type: "CONSULTATION" },
    });
    await getPrisma().visit.create({
      data: { patientId: patient.id, date: new Date(now - 1 * day), type: "CONTROLE" },
    });

    const response = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ kind: string; date: string; status: string | null }>;
      total: number;
    };
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
    expect(body.items.every((i) => i.status !== "CANCELLED")).toBe(true);
    const dates = body.items.map((i) => new Date(i.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("audits PATIENT_RECORD_VIEWED, scope 'history'", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect((audit?.detail as { scope: string }).scope).toBe("history");
  });

  // ortho-tester, étape 5 verification — minimum disclosure for the
  // timeline: no patient identity field (name/phone/email/birthDate) may
  // leak through an item, and the top-level shape must be exactly
  // { items, total, page, limit }.
  it("never leaks patient identity fields — items carry only the whitelisted timeline shape", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Nabil", lastName: "Haddad" });
    const service = await seedService();

    await getPrisma().visit.create({
      data: {
        patientId: patient.id,
        date: new Date(),
        type: "CONSULTATION",
        serviceId: service.id,
        notes: "visit note",
        treatment: "cleaning",
      },
    });

    const response = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
      ctx(patient.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
    };

    expect(Object.keys(body).sort()).toEqual(["items", "total", "page", "limit"].sort());
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["kind", "id", "date", "serviceName", "type", "notes", "treatment", "status"].sort(),
      );
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Nabil");
    expect(serialized).not.toContain("Haddad");
    expect(serialized).not.toContain(patient.id);
    expect(serialized).not.toContain(patient.phone);
  });

  // Task 13 étape 5 tour 2, MAJEUR-3 (ortho-security) — `visitCreateSchema`
  // accepts a bare "YYYY-MM-DD", which Prisma stores as exact midnight UTC:
  // every same-day Visit therefore ties on `date` to the millisecond. Without
  // an `id` tiebreak (DB-level AND in the TS merge sort), pagination over a
  // tied set is undefined — a page boundary can repeat or drop a row. Proof:
  // 3 Visit rows sharing the EXACT same `date`, fetched over 2 pages of
  // limit=2, must together contain each of the 3 ids EXACTLY once.
  it("never skips nor repeats a row across pages when several visits share the exact same date", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const sameDate = new Date("2026-01-10T00:00:00.000Z");

    const v1 = await getPrisma().visit.create({
      data: { patientId: patient.id, date: sameDate, type: "CONSULTATION" },
    });
    const v2 = await getPrisma().visit.create({
      data: { patientId: patient.id, date: sameDate, type: "CONTROLE" },
    });
    const v3 = await getPrisma().visit.create({
      data: { patientId: patient.id, date: sameDate, type: "URGENCE" },
    });

    const page1 = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history?limit=2&page=1`, cookie),
      ctx(patient.id),
    );
    const page2 = await patientHistoryRoute(
      getRequest(`/api/admin/patients/${patient.id}/history?limit=2&page=2`, cookie),
      ctx(patient.id),
    );
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    const body1 = (await page1.json()) as { items: Array<{ id: string }>; total: number };
    const body2 = (await page2.json()) as { items: Array<{ id: string }>; total: number };

    expect(body1.total).toBe(3);
    expect(body1.items).toHaveLength(2);
    expect(body2.items).toHaveLength(1);

    const ids = [...body1.items, ...body2.items].map((i) => i.id);
    // No repeat.
    expect(new Set(ids).size).toBe(3);
    // No skip — exactly the 3 seeded ids, in any order.
    expect(ids.slice().sort()).toEqual([v1.id, v2.id, v3.id].sort());
  });
});

describe("POST /api/admin/patients/[id]/visits", () => {
  it("creates the Visit (201) and audits VISIT_CREATED with detail {patientId, type} — NEVER notes/treatment", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const secretNotes = "CLINICAL-NOTE-MARKER-9911";
    const secretTreatment = "TREATMENT-MARKER-2244";

    const response = await patientVisitsRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${patient.id}/visits`,
        { date: "2026-01-15", type: "CONSULTATION", notes: secretNotes, treatment: secretTreatment },
        cookie,
      ),
      ctx(patient.id),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; type: string };
    expect(body.type).toBe("CONSULTATION");

    const dbVisit = await getPrisma().visit.findUniqueOrThrow({ where: { id: body.id } });
    expect(dbVisit.createdById).toBe(staff.id);
    expect(dbVisit.notes).toBe(secretNotes);

    const audit = await lastAudit(AuditAction.VISIT_CREATED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.entityType).toBe("Visit");
    expect(audit?.entityId).toBe(body.id);
    const detail = audit?.detail as { patientId: string; type: string };
    expect(detail.patientId).toBe(patient.id);
    expect(detail.type).toBe("CONSULTATION");
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain(secretNotes);
    expect(serialized).not.toContain(secretTreatment);
  });

  it("404s for an unknown patient id and creates nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const before = await getPrisma().visit.count();

    const response = await patientVisitsRoute(
      bodyRequest(
        "POST",
        "/api/admin/patients/does-not-exist/visits",
        { date: "2026-01-15", type: "CONSULTATION" },
        cookie,
      ),
      ctx("does-not-exist"),
    );
    expect(response.status).toBe(404);
    expect(await getPrisma().visit.count()).toBe(before);
  });

  it("400s for an unknown serviceId and creates nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const before = await getPrisma().visit.count();

    const response = await patientVisitsRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${patient.id}/visits`,
        { date: "2026-01-15", type: "CONSULTATION", serviceId: "does-not-exist" },
        cookie,
      ),
      ctx(patient.id),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_SERVICE");
    expect(await getPrisma().visit.count()).toBe(before);
  });

  // Task 13 étape 5 tour 2, MAJEUR-2 (ortho-security) — an anonymized chart
  // must never receive fresh clinical notes.
  it("409s PATIENT_ANONYMIZED for an anonymized patient and creates nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { anonymizedAt: new Date() },
    });
    const before = await getPrisma().visit.count();

    const response = await patientVisitsRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${patient.id}/visits`,
        { date: "2026-01-15", type: "CONSULTATION" },
        cookie,
      ),
      ctx(patient.id),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PATIENT_ANONYMIZED");
    expect(await getPrisma().visit.count()).toBe(before);
  });

  // Task 13 étape 5 tour 2, MAJEUR-1 (ortho-security) — same shared write
  // budget as POST /api/admin/patients and PATCH /[id].
  it("is rate-limited under the shared write budget (30/5min)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      last = await patientVisitsRoute(
        bodyRequest(
          "POST",
          `/api/admin/patients/${patient.id}/visits`,
          { date: "2026-01-15", type: "CONSULTATION" },
          cookie,
        ),
        ctx(patient.id),
      );
    }
    expect(last?.status).toBe(201);

    const overBudget = await patientVisitsRoute(
      bodyRequest(
        "POST",
        `/api/admin/patients/${patient.id}/visits`,
        { date: "2026-01-15", type: "CONSULTATION" },
        cookie,
      ),
      ctx(patient.id),
    );
    expect(overBudget.status).toBe(429);
    const body = (await overBudget.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 20000);
});

// Task 13 étape 5 (§Contraintes obligatoires issues de l'audit de l'étape 4,
// point 1) — the read rate limit is a SINGLE pool per staff session
// (`staff:<userId>:patients-read`), shared across the list route AND the two
// new [id]* GETs, not one budget per endpoint.
describe("read rate limit is shared across GET /api/admin/patients, GET /[id] and GET /[id]/history", () => {
  it("exhausting the budget on GET /[id]/history makes the very next GET /[id] call 429, with no patient data in the body", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Budget", lastName: "Exhausted" });

    let last: Response | undefined;
    for (let i = 0; i < 60; i++) {
      last = await patientHistoryRoute(
        getRequest(`/api/admin/patients/${patient.id}/history`, cookie),
        ctx(patient.id),
      );
    }
    expect(last?.status).toBe(200);

    const overBudget = await patientRecordRoute(
      getRequest(`/api/admin/patients/${patient.id}`, cookie),
      ctx(patient.id),
    );
    expect(overBudget.status).toBe(429);
    const body = (await overBudget.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Budget");
    expect(serialized).not.toContain("Exhausted");
    expect(serialized).not.toContain(patient.id);
  }, 20000);
});
