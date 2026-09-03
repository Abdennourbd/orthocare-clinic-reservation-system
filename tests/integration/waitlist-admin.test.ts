import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AuditAction,
  AuditActorType,
  Role,
  WaitlistSource,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
  addClinicDays,
} from "@/lib/time/clinicTime";
import { GET as waitlistListRoute, POST as waitlistCreateRoute } from "@/app/api/admin/waitlist/route";
import { DELETE as waitlistDeleteRoute } from "@/app/api/admin/waitlist/[id]/route";

// Task 17.2 — integration tests for the staff waitlist surface:
// GET /api/admin/waitlist (list), POST /api/admin/waitlist (STAFF-source
// create) and DELETE /api/admin/waitlist/[id] (deactivate). Setup mirrors
// sms-center.test.ts (users, session cookie, NextRequest construction).
//
// Dates are computed relative to the clinic-local today (never hardcoded),
// so the policy checks (no past, within horizon) stay green regardless of
// when the suite runs.

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("TZ", "UTC"); // vitest sets TZ=UTC usually but just to be sure
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `waitlist-admin-${Math.random().toString(36).slice(2)}@test.com`,
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

function postRequest(path: string, body: unknown, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "GET",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

function deleteRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "DELETE",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

async function createPatient(data: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  active?: boolean;
  anonymizedAt?: Date | null;
}) {
  const phone = data.phone ?? "0550123456";
  return getPrisma().patient.create({
    data: {
      firstName: data.firstName ?? "Amine",
      lastName: data.lastName ?? "Benali",
      phone,
      phoneE164: "+213" + phone.slice(1),
      firstNameNormalized: (data.firstName ?? "amine").toLowerCase(),
      lastNameNormalized: (data.lastName ?? "benali").toLowerCase(),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.anonymizedAt !== undefined ? { anonymizedAt: data.anonymizedAt } : {}),
    },
  });
}

async function createService(name = "Consultation", active = true) {
  return getPrisma().service.create({
    data: {
      name: { fr: name },
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
      description: { fr: "Test" },
      durationMinutes: 30,
      active,
    },
  });
}

function todayLocal(): string {
  return toClinicLocalDateString(new Date());
}

describe("POST /api/admin/waitlist", () => {
  it("creates a STAFF-source entry with dates stored as UTC midnight (201)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const d1 = addClinicDays(todayLocal(), 5);
    const d2 = addClinicDays(todayLocal(), 6);

    const response = await waitlistCreateRoute(
      postRequest("/api/admin/waitlist", { patientId: patient.id, serviceId: service.id, preferredDates: [d1, d2] }, cookie),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { entry: { id: string; source: string; active: boolean; preferredDates: string[] } };
    expect(body.entry.source).toBe("STAFF");
    expect(body.entry.active).toBe(true);
    // Each YYYY-MM-DD is stored as that clinic-local date's UTC midnight.
    expect(body.entry.preferredDates).toEqual([
      getClinicDayBoundsUTC(d1).startUTC.toISOString(),
      getClinicDayBoundsUTC(d2).startUTC.toISOString(),
    ]);

    // The audit trail records ids + count only — never the phone.
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.WAITLIST_ENTRY_ADDED },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityId).toBe(body.entry.id);
    expect(audit?.detail).toMatchObject({
      patientId: patient.id,
      serviceId: service.id,
      dateCount: 2,
    });
    expect(JSON.stringify(audit?.detail)).not.toContain("0550123456");
  });

  it("dedupes repeated dates before storing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const d1 = addClinicDays(todayLocal(), 5);
    const d2 = addClinicDays(todayLocal(), 6);

    const response = await waitlistCreateRoute(
      postRequest("/api/admin/waitlist", { patientId: patient.id, serviceId: service.id, preferredDates: [d2, d1, d2, d1] }, cookie),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { entry: { preferredDates: string[] } };
    expect(body.entry.preferredDates).toHaveLength(2);
  });

  it("rejects a past date with 400", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();

    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), -1)] },
        cookie,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a date beyond the booking horizon with 400", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();

    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), 120)] },
        cookie,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown patient", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const service = await createService();

    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: "does-not-exist", serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), 5)] },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for an inactive patient", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ active: false });
    const service = await createService();

    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), 5)] },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  it("returns 409 for an anonymized patient (documents pattern)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ anonymizedAt: new Date() });
    const service = await createService();

    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), 5)] },
        cookie,
      ),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PATIENT_ANONYMIZED");
  });

  it("returns 404 for an unknown or inactive service", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const inactiveService = await createService("Inactive", false);

    const unknownRes = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: "does-not-exist", preferredDates: [addClinicDays(todayLocal(), 5)] },
        cookie,
      ),
    );
    expect(unknownRes.status).toBe(404);

    const inactiveRes = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: patient.id, serviceId: inactiveService.id, preferredDates: [addClinicDays(todayLocal(), 5)] },
        cookie,
      ),
    );
    expect(inactiveRes.status).toBe(404);
  });

  it("returns 401 for an unauthenticated caller (never a 404 first)", async () => {
    const service = await createService();
    const response = await waitlistCreateRoute(
      postRequest(
        "/api/admin/waitlist",
        { patientId: "does-not-exist", serviceId: service.id, preferredDates: [addClinicDays(todayLocal(), 5)] },
      ),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for an empty body", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const response = await waitlistCreateRoute(postRequest("/api/admin/waitlist", undefined, cookie));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/admin/waitlist", () => {
  async function seedEntry(data: { serviceId: string; patientId: string; active?: boolean; daysAhead?: number }) {
    const d = addClinicDays(todayLocal(), data.daysAhead ?? 5);
    return getPrisma().waitlistEntry.create({
      data: {
        patientId: data.patientId,
        serviceId: data.serviceId,
        preferredDates: [getClinicDayBoundsUTC(d).startUTC],
        source: WaitlistSource.STAFF,
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
  }

  it("lists active entries newest-first with patient + service", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const first = await seedEntry({ serviceId: service.id, patientId: patient.id });
    const second = await seedEntry({ serviceId: service.id, patientId: patient.id });

    const response = await waitlistListRoute(getRequest("/api/admin/waitlist", cookie));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{
        id: string;
        patient: { firstName: string; phoneE164: string };
        service: { slug: string };
      }>;
      nextCursor: string | null;
    };
    expect(body.entries.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(body.entries[0].patient.firstName).toBe("Amine");
    expect(body.entries[0].patient.phoneE164).toBe("+213550123456");
    expect(body.entries[0].service.slug).toContain("consultation");
  });

  it("filters by serviceId", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const serviceA = await createService("Service A");
    const serviceB = await createService("Service B");
    await seedEntry({ serviceId: serviceA.id, patientId: patient.id });
    const wanted = await seedEntry({ serviceId: serviceB.id, patientId: patient.id });

    const response = await waitlistListRoute(getRequest(`/api/admin/waitlist?serviceId=${serviceB.id}`, cookie));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: Array<{ id: string }> };
    expect(body.entries.map((e) => e.id)).toEqual([wanted.id]);
  });

  it("filters by active=false and active=all", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const live = await seedEntry({ serviceId: service.id, patientId: patient.id });
    const removed = await seedEntry({ serviceId: service.id, patientId: patient.id, active: false });

    const inactiveRes = await waitlistListRoute(getRequest("/api/admin/waitlist?active=false", cookie));
    const inactiveBody = (await inactiveRes.json()) as { entries: Array<{ id: string }> };
    expect(inactiveBody.entries.map((e) => e.id)).toEqual([removed.id]);

    const allRes = await waitlistListRoute(getRequest("/api/admin/waitlist?active=all", cookie));
    const allBody = (await allRes.json()) as { entries: Array<{ id: string }> };
    expect(allBody.entries.map((e) => e.id).sort()).toEqual([live.id, removed.id].sort());
  });

  it("returns 401 for an unauthenticated caller", async () => {
    const response = await waitlistListRoute(getRequest("/api/admin/waitlist"));
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/admin/waitlist/[id]", () => {
  it("deactivates the entry without deleting it (keeps notifiedAt history)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const d = addClinicDays(todayLocal(), 5);
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [getClinicDayBoundsUTC(d).startUTC],
        source: WaitlistSource.STAFF,
        notifiedAt: new Date(),
      },
    });

    const response = await waitlistDeleteRoute(deleteRequest(`/api/admin/waitlist/${entry.id}`, cookie), {
      params: Promise.resolve({ id: entry.id }),
    });
    expect(response.status).toBe(200);

    const reloaded = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reloaded.active).toBe(false);
    // History survives the deactivation: dates + notification instant stay.
    expect(reloaded.preferredDates).toHaveLength(1);
    expect(reloaded.notifiedAt).not.toBeNull();
  });

  it("returns 404 on the second DELETE (no oracle for already-inactive)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({});
    const service = await createService();
    const d = addClinicDays(todayLocal(), 5);
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [getClinicDayBoundsUTC(d).startUTC],
        source: WaitlistSource.STAFF,
      },
    });

    const first = await waitlistDeleteRoute(deleteRequest(`/api/admin/waitlist/${entry.id}`, cookie), {
      params: Promise.resolve({ id: entry.id }),
    });
    expect(first.status).toBe(200);

    const second = await waitlistDeleteRoute(deleteRequest(`/api/admin/waitlist/${entry.id}`, cookie), {
      params: Promise.resolve({ id: entry.id }),
    });
    expect(second.status).toBe(404);
  });

  it("returns 404 for a missing id", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const response = await waitlistDeleteRoute(deleteRequest("/api/admin/waitlist/does-not-exist", cookie), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 401 for an unauthenticated caller (never a 404 first)", async () => {
    const response = await waitlistDeleteRoute(deleteRequest("/api/admin/waitlist/does-not-exist"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(response.status).toBe(401);
  });
});
