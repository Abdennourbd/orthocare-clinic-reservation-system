import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { GET as patientsListRoute, POST as patientsCreateRoute } from "@/app/api/admin/patients/route";

// Task 13 step 4 — GET (list/search, audited) + POST (create with duplicate
// acknowledgement, also audited on the 409 path) /api/admin/patients.
// tests/authz-matrix.test.ts already proves the role gate on every actor ×
// method combination; this file proves the route's own behavior: search,
// pagination defaults, phone validation, the duplicate-candidate contract,
// and — the point the task-13.md relay is strictest about — that the audit
// trail never carries the search string `q` nor any patient's name/phone.

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
      email: `patients-api-${Math.random().toString(36).slice(2)}@test.com`,
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

function postRequest(
  body: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {},
) {
  return new NextRequest("http://localhost:3000/api/admin/patients", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function lastAudit(action: AuditAction) {
  return getPrisma().auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: "desc" },
  });
}

describe("GET /api/admin/patients", () => {
  it("rejects an anonymous caller with 401 and no data", async () => {
    const response = await patientsListRoute(getRequest("/api/admin/patients"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a deactivated receptionist with the SAME 401 body as an anonymous caller, even when the search matches a real patient — the auth gate runs before any Patient read", async () => {
    const deactivated = await getPrisma().user.create({
      data: {
        name: "Deactivated Staff",
        email: `deactivated-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
        active: false,
      },
    });
    const cookie = await cookieFor(deactivated);
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Nassim",
        lastName: "Guerroudj",
        phone: "0550100099",
        phoneE164: "+213550100099",
      },
    });

    const anonymousResponse = await patientsListRoute(getRequest("/api/admin/patients"));
    const deactivatedResponse = await patientsListRoute(
      getRequest(`/api/admin/patients?q=${patient.lastName}`, cookie),
    );
    expect(deactivatedResponse.status).toBe(401);
    expect(deactivatedResponse.status).toBe(anonymousResponse.status);

    const anonymousBody = await anonymousResponse.json();
    const deactivatedBody = await deactivatedResponse.json();
    // Byte-for-byte identical generic body — no hint that a matching patient
    // exists, no partial patient data, nothing distinguishing "wrong session"
    // from "matching record found but withheld".
    expect(deactivatedBody).toEqual(anonymousBody);
    const serialized = JSON.stringify(deactivatedBody);
    expect(serialized).not.toContain(patient.id);
    expect(serialized).not.toContain("Guerroudj");
    expect(serialized).not.toContain("Nassim");
  });

  it("lists only active patients by default", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: { firstName: "Nadia", lastName: "Kaci", phone: "0550100001", phoneE164: "+213550100001", active: true },
    });
    await getPrisma().patient.create({
      data: { firstName: "Omar", lastName: "Ferhat", phone: "0550100002", phoneE164: "+213550100002", active: false },
    });

    const response = await patientsListRoute(getRequest("/api/admin/patients", cookie));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { patients: Array<{ firstName: string }>; total: number };
    expect(body.patients.map((p) => p.firstName)).toEqual(["Nadia"]);
    expect(body.total).toBe(1);
  });

  it("finds a patient by name AND by a phone format different from the one stored", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Yasmine",
        lastName: "Boudiaf",
        phone: "0550100003",
        phoneE164: "+213550100003",
      },
    });

    const byName = await patientsListRoute(
      getRequest("/api/admin/patients?q=Boudiaf", cookie),
    );
    const byNameBody = (await byName.json()) as { patients: Array<{ lastName: string }> };
    expect(byNameBody.patients.map((p) => p.lastName)).toEqual(["Boudiaf"]);

    // Same number typed with the international prefix and spaces — not the
    // raw string stored in Patient.phone — proves the search normalizes.
    const byPhone = await patientsListRoute(
      getRequest("/api/admin/patients?q=%2B213%20550%2010%2000%2003", cookie),
    );
    const byPhoneBody = (await byPhone.json()) as { patients: Array<{ lastName: string }> };
    expect(byPhoneBody.patients.map((p) => p.lastName)).toEqual(["Boudiaf"]);
  });

  it("documents an HONEST limitation: q search does NOT fold Arabic diacritics (vocalization/tatweel) — unlike findDuplicateCandidates, it is a raw Postgres ILIKE `contains`", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    // Stored unvocalized, as a receptionist would normally type it.
    await getPrisma().patient.create({
      data: {
        firstName: "أحمد",
        lastName: "محمد",
        phone: "0550100098",
        phoneE164: "+213550100098",
      },
    });

    // Exact substring, case-insensitive — this DOES work (ILIKE folds case
    // only, and the stored value is byte-identical to the query here).
    const exactMatch = await patientsListRoute(
      getRequest(`/api/admin/patients?q=${encodeURIComponent("محمد")}`, cookie),
    );
    const exactBody = (await exactMatch.json()) as { patients: Array<{ lastName: string }> };
    expect(exactBody.patients.map((p) => p.lastName)).toEqual(["محمد"]);

    // Fully vocalized query (harakat added: fatha/damma/shadda) for the same
    // name — NOT found. Postgres ILIKE folds case only, never diacritics;
    // that folding only exists on the write-time duplicate-detection path
    // (src/lib/patients/duplicates.ts, TypeScript-side NFD normalization),
    // never on this route's SQL-level `contains`. This is the honest,
    // verified answer to task-13.md étape 4's question, not an assumption.
    const vocalizedQuery = "مُحَمَّد";
    const vocalizedSearch = await patientsListRoute(
      getRequest(`/api/admin/patients?q=${encodeURIComponent(vocalizedQuery)}`, cookie),
    );
    const vocalizedBody = (await vocalizedSearch.json()) as { patients: unknown[]; total: number };
    expect(vocalizedBody.total).toBe(0);
    expect(vocalizedBody.patients).toEqual([]);

    // Tatweel/kashida-elongated query for the same name — also NOT found,
    // for the same reason.
    const tatweelQuery = "محـمد";
    const tatweelSearch = await patientsListRoute(
      getRequest(`/api/admin/patients?q=${encodeURIComponent(tatweelQuery)}`, cookie),
    );
    const tatweelBody = (await tatweelSearch.json()) as { patients: unknown[]; total: number };
    expect(tatweelBody.total).toBe(0);
    expect(tatweelBody.patients).toEqual([]);
  });

  it("returns the whitelisted fields only (no notes, email, birthDate)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Sara",
        lastName: "Amrani",
        phone: "0550100004",
        phoneE164: "+213550100004",
        notes: "confidential clinical note",
        email: "sara@example.com",
        birthDate: new Date("1990-01-01"),
      },
    });
    const response = await patientsListRoute(getRequest("/api/admin/patients", cookie));
    const body = (await response.json()) as { patients: Array<Record<string, unknown>> };
    expect(body.patients).toHaveLength(1);
    expect(Object.keys(body.patients[0]).sort()).toEqual(
      ["active", "anonymizedAt", "createdAt", "firstName", "id", "lastName", "phone"].sort(),
    );
  });

  // Task 13 étape 5 (§Contraintes obligatoires issues de l'audit de l'étape
  // 4, point 1 — the biggest MAJEUR carried forward): before this, the whole
  // patient directory was scrapeable in ceil(N/200) unthrottled requests.
  it("rate-limits repeated reads by the staff session's userId (429 after the window's cap, no patient data in the body)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Secret",
        lastName: "Marker",
        phone: "0550100097",
        phoneE164: "+213550100097",
      },
    });

    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await patientsListRoute(getRequest("/api/admin/patients?q=Secret", cookie));
    }
    expect(last?.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Secret");
    expect(serialized).not.toContain("Marker");
  }, 20000);

  it("audits the read as PATIENT_RECORD_VIEWED, scope 'list', and NEVER writes q to the audit log", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Karima",
        lastName: "Zeroual",
        phone: "0550100005",
        phoneE164: "+213550100005",
      },
    });

    const secretQuery = "Zeroual";
    const response = await patientsListRoute(
      getRequest(`/api/admin/patients?q=${secretQuery}`, cookie),
    );
    expect(response.status).toBe(200);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityId).toBe("list");
    const detail = audit?.detail as { scope: string; resultCount: number };
    expect(detail.scope).toBe("list");
    expect(detail.resultCount).toBe(1);
    // The strongest form of the assertion: the search string never appears
    // ANYWHERE in the serialized detail JSON, not just absent as a named key.
    expect(JSON.stringify(audit?.detail)).not.toContain(secretQuery);
  });
});

describe("POST /api/admin/patients", () => {
  it("rejects an anonymous caller with 401 and creates nothing", async () => {
    const before = await getPrisma().patient.count();
    const response = await patientsCreateRoute(
      postRequest({ firstName: "X", lastName: "Y", phone: "0550100006" }),
    );
    expect(response.status).toBe(401);
    expect(await getPrisma().patient.count()).toBe(before);
  });

  it("rejects a cross-site Origin with 403 CSRF_ORIGIN_MISMATCH", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const response = await patientsCreateRoute(
      postRequest(
        { firstName: "X", lastName: "Y", phone: "0550100007" },
        cookie,
        { origin: "http://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CSRF_ORIGIN_MISMATCH");
  });

  it("rejects a phone that does not normalize to an Algerian E.164 number with 422 INVALID_PHONE, before any write", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const before = await getPrisma().patient.count();
    const response = await patientsCreateRoute(
      postRequest({ firstName: "Bad", lastName: "Phone", phone: "not-a-phone" }, cookie),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_PHONE");
    expect(await getPrisma().patient.count()).toBe(before);
  });

  it("a receptionist can create a patient; createdById/updatedById are the calling staff", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    const response = await patientsCreateRoute(
      postRequest(
        { firstName: "Hicham", lastName: "Belkacem", phone: "0550100008" },
        cookie,
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; firstName: string };
    expect(body.firstName).toBe("Hicham");

    const dbPatient = await getPrisma().patient.findUnique({ where: { id: body.id } });
    expect(dbPatient?.createdById).toBe(staff.id);
    expect(dbPatient?.updatedById).toBe(staff.id);
    expect(dbPatient?.phoneE164).toBe("+213550100008");
  });

  // Task 13 étape 5 (§Contraintes obligatoires issues de l'audit de l'étape
  // 4, point 2): a counter-created record must never be simultaneously
  // opt-in (`messagingOptOut: false`, the schema default) AND unconsented
  // (`consentAt: null`) — that combination is exactly "receives marketing
  // messages with zero proof anyone agreed to it".
  it("writes consentAt/consentVersion on a staff-created record, matching the public booking path — never opt-in with no consent evidence", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().setting.upsert({
      where: { key: "consentVersion" },
      create: { key: "consentVersion", value: "2.1" },
      update: { value: "2.1" },
    });

    const response = await patientsCreateRoute(
      postRequest({ firstName: "Nawel", lastName: "Brahimi", phone: "0550100013" }, cookie),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };

    const dbPatient = await getPrisma().patient.findUnique({ where: { id: body.id } });
    expect(dbPatient?.consentAt).not.toBeNull();
    expect(dbPatient?.consentVersion).toBe("2.1");
    // The invariant itself: never opt-in-by-default with no consent proof.
    expect(dbPatient?.consentAt === null && dbPatient?.messagingOptOut === false).toBe(false);
  });

  it("returns 409 DUPLICATE_CANDIDATES for a homonym without acknowledgement, and creates nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const existing = await getPrisma().patient.create({
      data: {
        firstName: "Leila",
        lastName: "Mansouri",
        phone: "0550100009",
        phoneE164: "+213550100009",
      },
    });
    const before = await getPrisma().patient.count();

    const response = await patientsCreateRoute(
      postRequest(
        { firstName: "Leila", lastName: "Mansouri", phone: "0550999009" },
        cookie,
      ),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string };
      duplicates: Array<{ id: string }>;
    };
    expect(body.error.code).toBe("DUPLICATE_CANDIDATES");
    expect(body.duplicates.length).toBeGreaterThan(0);
    expect(body.duplicates.some((d) => d.id === existing.id)).toBe(true);
    expect(await getPrisma().patient.count()).toBe(before);
  });

  it("the same homonym request with duplicateAcknowledged: true creates the second patient (201)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Sofiane",
        lastName: "Cherif",
        phone: "0550100010",
        phoneE164: "+213550100010",
      },
    });
    const before = await getPrisma().patient.count();

    const response = await patientsCreateRoute(
      postRequest(
        {
          firstName: "Sofiane",
          lastName: "Cherif",
          phone: "0550888010",
          duplicateAcknowledged: true,
        },
        cookie,
      ),
    );
    expect(response.status).toBe(201);
    expect(await getPrisma().patient.count()).toBe(before + 1);
  });

  it("audits the 409 duplicate-check as PATIENT_RECORD_VIEWED, and the detail never contains the submitted name or phone", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Warda",
        lastName: "Sahraoui",
        phone: "0550100011",
        phoneE164: "+213550100011",
      },
    });

    const response = await patientsCreateRoute(
      postRequest({ firstName: "Warda", lastName: "Sahraoui", phone: "0550777011" }, cookie),
    );
    expect(response.status).toBe(409);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    const detail = audit?.detail as { scope: string; candidateCount: number; matchedOn: string[] };
    expect(detail.scope).toBe("duplicate-check");
    expect(detail.candidateCount).toBeGreaterThan(0);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("Warda");
    expect(serialized).not.toContain("Sahraoui");
    expect(serialized).not.toContain("0550100011");
    expect(serialized).not.toContain("0550777011");
  });

  it("audits PATIENT_CREATED with a detail that never contains the patient's name or phone", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const response = await patientsCreateRoute(
      postRequest({ firstName: "Rania", lastName: "Boumediene", phone: "0550100012" }, cookie),
    );
    expect(response.status).toBe(201);

    const audit = await lastAudit(AuditAction.PATIENT_CREATED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("Rania");
    expect(serialized).not.toContain("Boumediene");
    expect(serialized).not.toContain("0550100012");
    expect(serialized).not.toContain("+213550100012");
  });

  // Task 13 étape 4 tour 2 — the phoneSharingAcknowledged gate
  // (ortho-security BLOCKING finding, user-authorized fix). A PHONE-only
  // match (different name — a family member, not a homonym) must NOT be
  // let through by `duplicateAcknowledged` alone: it needs its own explicit
  // flag and its own 409 code, so sharing a phone is a conscious staff
  // gesture rather than the side-effect of dismissing an unrelated warning.
  it("returns 409 PHONE_ALREADY_REGISTERED for a phone-only match (different name) without phoneSharingAcknowledged, and creates nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const existing = await getPrisma().patient.create({
      data: {
        firstName: "Amine",
        lastName: "Belaid",
        phone: "0550700010",
        phoneE164: "+213550700010",
      },
    });
    const before = await getPrisma().patient.count();

    const response = await patientsCreateRoute(
      postRequest(
        { firstName: "Yacine", lastName: "Belaid-Family", phone: "0550700010" },
        cookie,
      ),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string };
      duplicates: Array<{ id: string }>;
    };
    expect(body.error.code).toBe("PHONE_ALREADY_REGISTERED");
    expect(body.duplicates.some((d) => d.id === existing.id)).toBe(true);
    expect(await getPrisma().patient.count()).toBe(before);
  });

  it("the same phone-sharing request with phoneSharingAcknowledged: true creates the second patient (201), sharing the phone", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const existing = await getPrisma().patient.create({
      data: {
        firstName: "Amine",
        lastName: "Bentaleb",
        phone: "0550700011",
        phoneE164: "+213550700011",
      },
    });
    const before = await getPrisma().patient.count();

    const response = await patientsCreateRoute(
      postRequest(
        {
          firstName: "Yacine",
          lastName: "Bentaleb",
          phone: "0550700011",
          phoneSharingAcknowledged: true,
        },
        cookie,
      ),
    );
    expect(response.status).toBe(201);
    expect(await getPrisma().patient.count()).toBe(before + 1);

    const created = (await response.json()) as { id: string; phone: string };
    const both = await getPrisma().patient.findMany({
      where: { phoneE164: "+213550700011" },
    });
    expect(both.map((p) => p.id).sort()).toEqual([existing.id, created.id].sort());
  });

  it("audits the phone-sharing 409 as PATIENT_RECORD_VIEWED, scope 'phone-sharing-check', with a detail that never contains a name or phone", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    await getPrisma().patient.create({
      data: {
        firstName: "Amine",
        lastName: "Ould-Kaddour",
        phone: "0550700012",
        phoneE164: "+213550700012",
      },
    });

    const response = await patientsCreateRoute(
      postRequest(
        { firstName: "Yacine", lastName: "Ould-Kaddour-Family", phone: "0550700012" },
        cookie,
      ),
    );
    expect(response.status).toBe(409);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    const detail = audit?.detail as { scope: string; candidateCount: number; matchedOn: string[] };
    expect(detail.scope).toBe("phone-sharing-check");
    expect(detail.candidateCount).toBeGreaterThan(0);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("Amine");
    expect(serialized).not.toContain("Ould-Kaddour");
    expect(serialized).not.toContain("Yacine");
    expect(serialized).not.toContain("0550700012");
  });

  it("rate-limits repeated writes by the staff session's userId (429 after the window's cap)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    // Every call uses the SAME invalid-phone body: each returns 422 before
    // touching the database, so this proves the limiter counts requests
    // regardless of outcome, and does so fast (no duplicate-detection scan).
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await patientsCreateRoute(
        postRequest({ firstName: "Rate", lastName: "Limit", phone: "bad" }, cookie),
      );
    }
    expect(last?.status).toBe(429);
  }, 15000);
});
