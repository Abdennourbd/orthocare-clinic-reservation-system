import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  Role,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { getClinicWeekRange } from "@/lib/kpis/aggregations";
import { GET } from "@/app/api/admin/kpis/route";
import { localStart } from "./helpers/testDates";

// Task 18 — GET /api/admin/kpis: week Sat→Thu aggregates, both roles,
// no audit row (counts only). Fixtures are seeded relative to the REAL
// clinic today so the test stays green regardless of when it runs.

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");

  await getPrisma().setting.create({
    data: {
      key: "workingHours",
      value: {
        sat: { open: "10:00", close: "17:00" },
        sun: { open: "10:00", close: "17:00" },
        mon: { open: "10:00", close: "17:00" },
        tue: { open: "10:00", close: "17:00" },
        wed: { open: "10:00", close: "17:00" },
        thu: { open: "10:00", close: "17:00" },
        fri: { closed: true },
      },
    },
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "KPI Test",
      email: `kpi-${Math.random().toString(36).slice(2)}@test.com`,
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
    method: "GET",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

async function seedWeek() {
  const todayLocal = toClinicLocalDateString(new Date());
  const { from, to } = getClinicWeekRange(todayLocal);

  const service = await getPrisma().service.create({
    data: {
      slug: `kpi-svc-${Math.random().toString(36).slice(2)}`,
      name: { fr: "Consultation" },
      description: { fr: "Consultation" },
      durationMinutes: 30,
    },
  });
  const patient = await getPrisma().patient.create({
    data: {
      firstName: "Sara",
      lastName: "KPI",
      firstNameNormalized: "sara",
      lastNameNormalized: "kpi",
      phone: "0550111222",
      phoneE164: "+213550111222",
    },
  });

  // Two appointments inside the week: one CONFIRMED ONLINE, one COMPLETED MANUAL.
  const createdAt = new Date("2026-01-01T08:00:00.000Z");
  await getPrisma().appointment.create({
    data: {
      patientId: patient.id,
      serviceId: service.id,
      startTime: localStart(from, "10:00"),
      endTime: localStart(from, "10:30"),
      status: AppointmentStatus.CONFIRMED,
      source: AppointmentSource.ONLINE,
      createdAt,
      confirmedAt: new Date("2026-01-01T10:00:00.000Z"),
    },
  });
  await getPrisma().appointment.create({
    data: {
      patientId: patient.id,
      serviceId: service.id,
      startTime: localStart(from, "11:00"),
      endTime: localStart(from, "11:30"),
      status: AppointmentStatus.COMPLETED,
      source: AppointmentSource.MANUAL,
      createdAt,
      confirmedAt: new Date("2026-01-01T09:00:00.000Z"),
    },
  });

  return { from, to, todayLocal };
}

describe("GET /api/admin/kpis", () => {
  it("returns week aggregates by default (Sat→Thu) for staff", async () => {
    const { from, to } = await seedWeek();
    const staff = await createStaff(Role.RECEPTIONIST);

    const res = await GET(getRequest("/api/admin/kpis", await cookieFor(staff)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      range: { from: string; to: string };
      kpis: {
        total: number;
        newPatients: number;
        openMinutes: number;
        onlineShare: number | null;
      };
    };
    expect(body.range).toEqual({ from, to });
    expect(body.kpis.total).toBe(2);
    // The seeded patient was created "now" (inside the week).
    expect(body.kpis.newPatients).toBe(1);
    expect(body.kpis.openMinutes).toBeGreaterThan(0);
    expect(body.kpis.onlineShare).toBeCloseTo(0.5, 5);
  });

  it("respects an explicit from/to range", async () => {
    const { from } = await seedWeek();
    const staff = await createStaff(Role.ADMIN);

    const res = await GET(
      getRequest(`/api/admin/kpis?from=${from}&to=${from}`, await cookieFor(staff)),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      range: { from: string; to: string };
      kpis: { total: number };
    };
    expect(body.range).toEqual({ from, to: from });
    // Both seeded appointments are on `from`.
    expect(body.kpis.total).toBe(2);
  });

  it("rejects an invalid date with 400", async () => {
    const staff = await createStaff(Role.ADMIN);
    const res = await GET(
      getRequest("/api/admin/kpis?from=not-a-date", await cookieFor(staff)),
    );
    expect(res.status).toBe(400);
  });

  it("rejects anonymous callers with 401 and writes no audit row", async () => {
    await seedWeek();
    const res = await GET(getRequest("/api/admin/kpis"));
    expect(res.status).toBe(401);
    expect(await getPrisma().auditLog.count()).toBe(0);
  });

  it("writes no audit row on an authorized read (counts only)", async () => {
    await seedWeek();
    const staff = await createStaff(Role.RECEPTIONIST);
    const res = await GET(getRequest("/api/admin/kpis", await cookieFor(staff)));
    expect(res.status).toBe(200);
    expect(await getPrisma().auditLog.count()).toBe(0);
  });
});
