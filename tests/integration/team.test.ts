import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { GET as teamList, POST as teamCreate } from "@/app/api/admin/team/route";
import { PATCH as teamPatch } from "@/app/api/admin/team/[id]/route";
import { POST as teamReset } from "@/app/api/admin/team/[id]/reset-password/route";

// Task 20 — RED: team management (ADMIN-only). Fails until routes exist.

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
      name: `Team ${role}`,
      email: `team-${role}-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active,
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

function req(method: string, path: string, cookie?: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/admin/team", () => {
  it("lists staff for ADMIN, 403 for receptionist, 401 for anonymous", async () => {
    const admin = await createStaff(Role.ADMIN);
    const receptionist = await createStaff(Role.RECEPTIONIST);
    expect((await teamList(req("GET", "/api/admin/team", await cookieFor(admin)))).status).toBe(200);
    expect(
      (await teamList(req("GET", "/api/admin/team", await cookieFor(receptionist)))).status,
    ).toBe(403);
    expect((await teamList(req("GET", "/api/admin/team"))).status).toBe(401);
  });
});

describe("POST /api/admin/team", () => {
  it("creates a receptionist with mustChangePassword and audited", async () => {
    const admin = await createStaff(Role.ADMIN);
    const email = `new-recep-${Math.random().toString(36).slice(2)}@test.com`;
    const response = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {
        name: "Lina Reception",
        email,
        password: "TempPassword-2026-Secure",
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { id: string; role: string } };
    const row = await getPrisma().user.findUnique({ where: { id: body.user.id } });
    expect(row?.role).toBe("RECEPTIONIST");
    expect(row?.mustChangePassword).toBe(true);
    expect(await verifyPassword(row!.passwordHash, "TempPassword-2026-Secure")).toBe(true);
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.TEAM_MEMBER_CREATED },
    });
    expect(audit?.userId).toBe(admin.id);
    expect(JSON.stringify(audit?.detail)).not.toContain("TempPassword-2026-Secure");
  });

  it("rejects weak passwords and duplicate emails", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    expect(
      (
        await teamCreate(
          req("POST", "/api/admin/team", cookie, {
            name: "Faible",
            email: `faible-${Math.random().toString(36).slice(2)}@test.com`,
            password: "short",
          }),
        )
      ).status,
    ).toBe(400);
    const email = `dup-${Math.random().toString(36).slice(2)}@test.com`;
    await teamCreate(
      req("POST", "/api/admin/team", cookie, { name: "A", email, password: "TempPassword-2026-Secure" }),
    );
    expect(
      (
        await teamCreate(
          req("POST", "/api/admin/team", cookie, { name: "B", email, password: "TempPassword-2026-Secure" }),
        )
      ).status,
    ).toBe(409);
  });
});

describe("PATCH /api/admin/team/[id]", () => {
  it("deactivates staff, bumps tokenVersion and audits", async () => {
    const admin = await createStaff(Role.ADMIN);
    const target = await getPrisma().user.create({
      data: {
        name: "Target",
        email: `target-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    const cookie = await cookieFor(admin);
    const response = await teamPatch(
      req("PATCH", `/api/admin/team/${target.id}`, cookie, { active: false }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(response.status).toBe(200);
    const row = await getPrisma().user.findUnique({ where: { id: target.id } });
    expect(row?.active).toBe(false);
    expect(row?.tokenVersion).toBe(1);
    expect(
      await getPrisma().auditLog.findFirst({
        where: { action: AuditAction.TEAM_MEMBER_DEACTIVATED },
      }),
    ).toBeTruthy();
  });

  it("refuses self-deactivation", async () => {
    const admin = await createStaff(Role.ADMIN);
    const response = await teamPatch(
      req("PATCH", `/api/admin/team/${admin.id}`, await cookieFor(admin), { active: false }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect([400, 403]).toContain(response.status);
  });
});

describe("POST /api/admin/team/[id]/reset-password", () => {
  it("rotates password, forces change, revokes sessions and audits", async () => {
    const admin = await createStaff(Role.ADMIN);
    const target = await getPrisma().user.create({
      data: {
        name: "Reset",
        email: `reset-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    const staleCookie = await cookieFor({ ...target, tokenVersion: 0 });
    const response = await teamReset(
      req("POST", `/api/admin/team/${target.id}/reset-password`, await cookieFor(admin), {
        newPassword: "ResetPassword-2026-New",
      }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(response.status).toBe(200);
    const row = await getPrisma().user.findUnique({ where: { id: target.id } });
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.tokenVersion).toBe(1);
    expect(await verifyPassword(row!.passwordHash, "ResetPassword-2026-New")).toBe(true);
    // Stale session revoked: team list with the old token is now 401.
    expect((await teamList(req("GET", "/api/admin/team", staleCookie))).status).toBe(401);
    expect(
      await getPrisma().auditLog.findFirst({ where: { action: AuditAction.PASSWORD_RESET } }),
    ).toBeTruthy();
  });
});
