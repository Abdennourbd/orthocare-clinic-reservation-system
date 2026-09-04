import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, Role, AppointmentStatus, AppointmentSource } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { futureBookableLocalStart } from "@/../tests/integration/helpers/testDates";
import { addClinicDays, toClinicLocalDateString } from "@/lib/time/clinicTime";

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("TZ", "UTC");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "Range Test",
      email: `range-${Math.random().toString(36).slice(2)}@test.com`,
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

describe("GET /api/admin/appointments/range", () => {
  it("returns the week chrono + audits range-view without PII", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Lina",
        lastName: "Haddad",
        firstNameNormalized: "lina",
        lastNameNormalized: "haddad",
        phone: "0550111222",
        phoneE164: "+213550111222",
      },
    });
    const service = await getPrisma().service.create({
      data: { name: "Consult", slug: `consult-${Date.now()}`, description: "t", durationMinutes: 30, active: true },
    });
    const startUTC = await futureBookableLocalStart("11:00", 2);
    const from = toClinicLocalDateString(startUTC);
    const to = addClinicDays(from, 5);
    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: startUTC,
        endTime: new Date(startUTC.getTime() + 30 * 60000),
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ONLINE,
      },
    });

    const { GET } = await import("./route");
    const response = await GET(getRequest(`/api/admin/appointments/range?from=${from}&to=${to}`, cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.from).toBe(from);
    expect(body.to).toBe(to);
    expect(body.appointments.length).toBe(1);
    expect(body.appointments[0].patient.firstName).toBe("Lina");

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.PATIENT_RECORD_VIEWED },
      orderBy: { createdAt: "desc" },
    });
    const detail = (audit?.detail ?? {}) as Record<string, unknown>;
    expect(detail.scope).toBe("range-view");
    expect(detail.from).toBe(from);
    expect(detail.resultCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("Lina");
    expect(JSON.stringify(detail)).not.toContain("0550");
  });

  it("400 on inverted range and on range > 31 days", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const { GET } = await import("./route");

    const inverted = await GET(getRequest("/api/admin/appointments/range?from=2026-09-10&to=2026-09-04", cookie));
    expect(inverted.status).toBe(400);

    const tooLong = await GET(getRequest("/api/admin/appointments/range?from=2026-01-01&to=2026-03-15", cookie));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("filters by status", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Yac",
        lastName: "Ben",
        firstNameNormalized: "yac",
        lastNameNormalized: "ben",
        phone: "0550999001",
        phoneE164: "+213550999001",
      },
    });
    const service = await getPrisma().service.create({
      data: { name: "Ctrl", slug: `ctrl-${Date.now()}`, description: "t", durationMinutes: 30, active: true },
    });
    const startUTC = await futureBookableLocalStart("12:00", 3);
    const from = toClinicLocalDateString(startUTC);
    const to = addClinicDays(from, 2);
    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: startUTC,
        endTime: new Date(startUTC.getTime() + 30 * 60000),
        status: AppointmentStatus.PENDING,
        source: AppointmentSource.ONLINE,
      },
    });

    const { GET } = await import("./route");
    const res = await GET(
      getRequest(`/api/admin/appointments/range?from=${from}&to=${to}&status=CONFIRMED`, cookie),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).appointments).toEqual([]);
  });

  it("401 without session (guard runs before validation)", async () => {
    const { GET } = await import("./route");
    const res = await GET(getRequest("/api/admin/appointments/range?from=bad&to=bad"));
    expect(res.status).toBe(401);
  });
});
