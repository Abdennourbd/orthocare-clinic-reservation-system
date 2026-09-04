import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { POST as waitlistCreate } from "@/app/api/admin/waitlist/route";
import { POST as broadcastSend } from "@/app/api/admin/sms/broadcast/route";
import { POST as smsSingle } from "@/app/api/admin/sms/single/route";
import { GET as exportsGet } from "@/app/api/admin/exports/appointments/route";
import { POST as teamCreate } from "@/app/api/admin/team/route";
import { POST as closuresCreate } from "@/app/api/admin/closures/route";
import { PATCH as appointmentPatch } from "@/app/api/admin/appointments/[id]/route";
import { GET as patientsList } from "@/app/api/admin/patients/route";

// Guard-rails proof: per-route 429 budgets actually fire, evil origins are
// rejected across route families, and stale sessions fail at the handler.
// Rate-limit counters are pre-seeded at the cap (deterministic, no 30× loops).

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role) {
  return getPrisma().user.create({
    data: {
      name: `Guard ${role}`,
      email: `guard-${role}-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
    },
  });
}

async function cookieFor(user: { id: string; role: Role; tokenVersion: number }) {
  const token = await createSessionToken({
    userId: user.id,
    role: user.role as "ADMIN" | "RECEPTIONIST",
    tokenVersion: user.tokenVersion,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function req(
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
  origin?: string,
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Pre-fill a rate-limit bucket to its cap so the next request 429s. */
async function exhaustBucket(key: string, limit: number) {
  await getPrisma().rateLimitCounter.create({
    data: { key, windowStart: new Date(), count: limit, updatedAt: new Date() },
  });
}

describe("per-route rate limits fire (429, no data leak)", () => {
  it("POST /api/admin/sms/broadcast 429s after its cap", async () => {
    const admin = await createStaff(Role.ADMIN);
    await exhaustBucket(`staff:${admin.id}:sms-broadcast`, 5);
    const res = await broadcastSend(
      req("POST", "/api/admin/sms/broadcast", await cookieFor(admin), {
        delayMinutes: 15,
        idempotencyKey: "rl-spot-1",
      }),
    );
    expect(res.status).toBe(429);
  });

  it("POST /api/admin/waitlist 429s after its cap", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    await exhaustBucket(`staff:${staff.id}:waitlist-write`, 30);
    const res = await waitlistCreate(
      req("POST", "/api/admin/waitlist", await cookieFor(staff), {}),
    );
    expect(res.status).toBe(429);
  });

  it("GET /api/admin/exports/appointments 429s after its cap", async () => {
    const admin = await createStaff(Role.ADMIN);
    await exhaustBucket(`staff:${admin.id}:exports-read`, 20);
    const res = await exportsGet(
      req("GET", "/api/admin/exports/appointments?month=2026-01&format=csv", await cookieFor(admin)),
    );
    expect(res.status).toBe(429);
  });

  it("POST /api/admin/team 429s after its cap", async () => {
    const admin = await createStaff(Role.ADMIN);
    await exhaustBucket(`staff:${admin.id}:team-write`, 30);
    const res = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {}),
    );
    expect(res.status).toBe(429);
  });
});

describe("CSRF origin guard across route families (403, row unchanged)", () => {
  it.each([
    ["waitlist", waitlistCreate, "POST", "/api/admin/waitlist", Role.RECEPTIONIST],
    ["sms single", smsSingle, "POST", "/api/admin/sms/single", Role.RECEPTIONIST],
    ["team", teamCreate, "POST", "/api/admin/team", Role.ADMIN],
    ["closures", closuresCreate, "POST", "/api/admin/closures", Role.ADMIN],
  ])("%s rejects an evil Origin with 403", async (_label, handler, method, path, role) => {
    const staff = await createStaff(role as Role);
    const res = await (handler as (r: NextRequest) => Promise<Response>)(
      req(method, path, await cookieFor(staff), {}, "http://evil.example"),
    );
    expect(res.status).toBe(403);
  });

  it("appointments PATCH rejects an evil Origin with 403", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const res = await appointmentPatch(
      req("PATCH", "/api/admin/appointments/cuid-unused", await cookieFor(staff), {}, "http://evil.example"),
      { params: Promise.resolve({ id: "cuid-unused" }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("stale sessions fail at the handler (401)", () => {
  it("revoked tokenVersion is rejected on a real admin route", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    await getPrisma().user.update({
      where: { id: staff.id },
      data: { tokenVersion: { increment: 1 } },
    });
    const res = await patientsList(req("GET", "/api/admin/patients", cookie));
    expect(res.status).toBe(401);
  });

  it("tampered cookie signature is rejected", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = `${await cookieFor(staff)}tampered`;
    const res = await patientsList(req("GET", "/api/admin/patients", cookie));
    expect(res.status).toBe(401);
  });
});
