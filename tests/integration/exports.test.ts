import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  AuditAction,
  Role,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { GET as exportAppointments } from "@/app/api/admin/exports/appointments/route";
import { GET as daySheet } from "@/app/api/admin/exports/day-sheet/route";
import { localStart } from "./helpers/testDates";

// Task 19 — exports: monthly CSV/XLSX (ADMIN-only, audited, notes opt-in) +
// printable day sheet. Fixtures are seeded in the REAL current clinic month
// so the test stays green regardless of when it runs.

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role, active = true) {
  return getPrisma().user.create({
    data: {
      name: `Exports ${role}`,
      email: `exports-${role}-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active,
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

async function seedMonth() {
  const month = toClinicLocalDateString(new Date()).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  const service = await getPrisma().service.create({
    data: {
      slug: `exp-svc-${Math.random().toString(36).slice(2)}`,
      name: { fr: "Consultation" },
      description: { fr: "Consultation" },
      durationMinutes: 30,
    },
  });
  const patient = await getPrisma().patient.create({
    data: {
      firstName: "Sara",
      lastName: "Export",
      firstNameNormalized: "sara",
      lastNameNormalized: "export",
      phone: "0550111222",
      phoneE164: "+213550111222",
    },
  });

  const common = {
    patientId: patient.id,
    serviceId: service.id,
    source: AppointmentSource.ONLINE,
  };
  // Two rows inside the month (one with a clinical note), one outside it.
  await getPrisma().appointment.create({
    data: {
      ...common,
      startTime: localStart(`${month}-05`, "10:00"),
      endTime: localStart(`${month}-05`, "10:30"),
      status: AppointmentStatus.CONFIRMED,
      visitNotes: "Note ultra-sensible",
    },
  });
  await getPrisma().appointment.create({
    data: {
      ...common,
      startTime: localStart(`${month}-15`, "11:00"),
      endTime: localStart(`${month}-15`, "11:30"),
      status: AppointmentStatus.COMPLETED,
    },
  });
  await getPrisma().appointment.create({
    data: {
      ...common,
      startTime: localStart(`${nextMonth}-01`, "10:00"),
      endTime: localStart(`${nextMonth}-01`, "10:30"),
      status: AppointmentStatus.CONFIRMED,
    },
  });
  return { month, dayWithOne: `${month}-05` };
}

describe("GET /api/admin/exports/appointments", () => {
  it("returns the month's rows as CSV (BOM + ; delimiter), notes excluded by default", async () => {
    const { month } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    const response = await exportAppointments(
      getRequest(
        `/api/admin/exports/appointments?month=${month}&format=csv`,
        await cookieFor(admin),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      `export-rendez-vous-${month}.csv`,
    );
    const bytes = Buffer.from(await response.clone().arrayBuffer());
    // UTF-8 BOM survives on the wire (Response.text() decodes it away, so
    // assert on the raw bytes): EF BB BF.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");
    // Header + the 2 in-month rows (the next-month row is excluded).
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Date;Heure;Patient");
    expect(lines[0]).not.toContain("Notes");
    expect(text).toContain("Sara Export");
    expect(text).not.toContain("Note ultra-sensible");
  });

  it("includes the notes column only on explicit includeNotes=true", async () => {
    const { month } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    const response = await exportAppointments(
      getRequest(
        `/api/admin/exports/appointments?month=${month}&format=csv&includeNotes=true`,
        await cookieFor(admin),
      ),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Notes cliniques");
    expect(text).toContain("Note ultra-sensible");
  });

  it("returns a readable XLSX workbook with the same rows", async () => {
    const { month } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    const response = await exportAppointments(
      getRequest(
        `/api/admin/exports/appointments?month=${month}&format=xlsx`,
        await cookieFor(admin),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "spreadsheetml.sheet",
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 },
    );
    expect(aoa).toHaveLength(3);
    expect(aoa[0][2]).toBe("Patient");
  });

  it("audits every export as EXPORT_GENERATED with row count (never patient data)", async () => {
    const { month } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    await exportAppointments(
      getRequest(
        `/api/admin/exports/appointments?month=${month}&format=csv`,
        await cookieFor(admin),
      ),
    );
    const entry = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.EXPORT_GENERATED },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.actorType).toBe("STAFF");
    expect(entry?.userId).toBe(admin.id);
    expect(entry?.detail).toMatchObject({
      scope: "appointments-export",
      month,
      format: "csv",
      rowCount: 2,
    });
    expect(JSON.stringify(entry?.detail)).not.toContain("Sara");
    expect(JSON.stringify(entry?.detail)).not.toContain("Note ultra-sensible");
  });

  it("rejects anonymous (401), receptionist (403) and deactivated (401)", async () => {
    const { month } = await seedMonth();
    const receptionist = await createStaff(Role.RECEPTIONIST);
    const deactivated = await createStaff(Role.ADMIN, false);

    expect(
      (
        await exportAppointments(
          getRequest(`/api/admin/exports/appointments?month=${month}&format=csv`),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await exportAppointments(
          getRequest(
            `/api/admin/exports/appointments?month=${month}&format=csv`,
            await cookieFor(receptionist),
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await exportAppointments(
          getRequest(
            `/api/admin/exports/appointments?month=${month}&format=csv`,
            await cookieFor(deactivated),
          ),
        )
      ).status,
    ).toBe(401);

    // Refused reads leave no audit trace of their own.
    expect(
      await getPrisma().auditLog.count({
        where: { action: AuditAction.EXPORT_GENERATED },
      }),
    ).toBe(0);
  });

  it("400s on a malformed month or format (after auth)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    expect(
      (
        await exportAppointments(
          getRequest("/api/admin/exports/appointments?month=2026-13&format=csv", cookie),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await exportAppointments(
          getRequest("/api/admin/exports/appointments?month=2026-09&format=pdf", cookie),
        )
      ).status,
    ).toBe(400);
    expect(
      (await exportAppointments(getRequest("/api/admin/exports/appointments", cookie))).status,
    ).toBe(400);
  });
});

describe("GET /api/admin/exports/day-sheet", () => {
  it("returns the day's appointments ordered by start time (ADMIN)", async () => {
    const { dayWithOne } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    const response = await daySheet(
      getRequest(`/api/admin/exports/day-sheet?date=${dayWithOne}`, await cookieFor(admin)),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      date: string;
      appointments: Array<{ patientFirstName: string; serviceName: string }>;
    };
    expect(body.date).toBe(dayWithOne);
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].patientFirstName).toBe("Sara");
    expect(body.appointments[0].serviceName).toBe("Consultation");
  });

  it("audits the day sheet and refuses non-admins", async () => {
    const { dayWithOne } = await seedMonth();
    const admin = await createStaff(Role.ADMIN);
    const receptionist = await createStaff(Role.RECEPTIONIST);

    expect(
      (await daySheet(getRequest(`/api/admin/exports/day-sheet?date=${dayWithOne}`))).status,
    ).toBe(401);
    expect(
      (
        await daySheet(
          getRequest(
            `/api/admin/exports/day-sheet?date=${dayWithOne}`,
            await cookieFor(receptionist),
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await daySheet(
          getRequest(`/api/admin/exports/day-sheet?date=${dayWithOne}`, await cookieFor(admin)),
        )
      ).status,
    ).toBe(200);

    const entries = await getPrisma().auditLog.findMany({
      where: { action: AuditAction.EXPORT_GENERATED },
    });
    // Exactly one audit row — the successful ADMIN read only.
    expect(entries).toHaveLength(1);
    expect(entries[0].detail).toMatchObject({ scope: "day-sheet", date: dayWithOne, rowCount: 1 });
  });

  it("400s on an impossible date (after auth)", async () => {
    const admin = await createStaff(Role.ADMIN);
    expect(
      (
        await daySheet(
          getRequest("/api/admin/exports/day-sheet?date=2026-02-30", await cookieFor(admin)),
        )
      ).status,
    ).toBe(400);
  });
});
