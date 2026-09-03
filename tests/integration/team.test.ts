import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { GET as teamList, POST as teamCreate } from "@/app/api/admin/team/route";
import { PATCH as teamPatch } from "@/app/api/admin/team/[id]/route";
import { POST as teamReset } from "@/app/api/admin/team/[id]/reset-password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as changePassword } from "@/app/api/auth/change-password/route";

// Task 20 — team management (ADMIN-only): create, deactivate, role change,
// password reset. Route-level integration against the test DB.

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
    const weak = await teamCreate(
      req("POST", "/api/admin/team", cookie, {
        name: "Faible",
        email: `faible-${Math.random().toString(36).slice(2)}@test.com`,
        password: "short",
      }),
    );
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as { error: { code: string } }).error.code).toBe("WEAK_PASSWORD");
    const email = `dup-${Math.random().toString(36).slice(2)}@test.com`;
    await teamCreate(
      req("POST", "/api/admin/team", cookie, { name: "A", email, password: "TempPassword-2026-Secure" }),
    );
    const dup = await teamCreate(
      req("POST", "/api/admin/team", cookie, { name: "B", email, password: "TempPassword-2026-Secure" }),
    );
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("EMAIL_TAKEN");
    // Case-insensitive duplicate (schema lowercases, legacy rows may not be).
    const upper = await teamCreate(
      req("POST", "/api/admin/team", cookie, { name: "C", email: email.toUpperCase(), password: "TempPassword-2026-Secure" }),
    );
    expect(upper.status).toBe(409);
  });

  it("never leaks passwordHash in list or create responses", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const created = await teamCreate(
      req("POST", "/api/admin/team", cookie, {
        name: "Discret",
        email: `discret-${Math.random().toString(36).slice(2)}@test.com`,
        password: "TempPassword-2026-Secure",
      }),
    );
    expect(JSON.stringify(await created.clone().json())).not.toContain("passwordHash");
    const listed = await teamList(req("GET", "/api/admin/team", cookie));
    const text = JSON.stringify(await listed.json());
    expect(text).not.toContain("passwordHash");
    expect(text).toContain("mustChangePassword");
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
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.TEAM_MEMBER_DEACTIVATED, entityId: target.id },
    });
    expect(audit?.userId).toBe(admin.id);
    expect(audit?.detail).toMatchObject({ from: true, to: false });
  });

  it("deactivated staff cannot log in and their live session is revoked", async () => {
    const admin = await createStaff(Role.ADMIN);
    const email = `login-${Math.random().toString(36).slice(2)}@test.com`;
    const created = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {
        name: "Login",
        email,
        password: "TempPassword-2026-Secure",
      }),
    );
    const targetId = ((await created.json()) as { user: { id: string } }).user.id;
    const target = (await getPrisma().user.findUnique({ where: { id: targetId } }))!;
    const liveCookie = await cookieFor(target);
    expect((await teamList(req("GET", "/api/admin/team", liveCookie))).status).toBe(403);
    await teamPatch(
      req("PATCH", `/api/admin/team/${targetId}`, await cookieFor(admin), { active: false }),
      { params: Promise.resolve({ id: targetId }) },
    );
    // Old session revoked instantly via the tokenVersion bump.
    expect((await teamList(req("GET", "/api/admin/team", liveCookie))).status).toBe(401);
    // Login as a deactivated account fails generically (no existence oracle).
    const attempt = await login(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "TempPassword-2026-Secure" }),
      }),
    );
    expect(attempt.status).toBe(401);
  });

  it("mustChangePassword blocks admin APIs until rotated", async () => {
    const admin = await createStaff(Role.ADMIN);
    const email = `pending-${Math.random().toString(36).slice(2)}@test.com`;
    const created = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {
        name: "Pending",
        email,
        password: "TempPassword-2026-Secure",
      }),
    );
    const targetId = ((await created.json()) as { user: { id: string } }).user.id;
    const target = (await getPrisma().user.findUnique({ where: { id: targetId } }))!;
    const pendingCookie = await cookieFor(target);
    const blocked = await teamList(req("GET", "/api/admin/team", pendingCookie));
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
  });

  it("promotes a receptionist to ADMIN without revoking sessions, audited", async () => {
    const admin = await createStaff(Role.ADMIN);
    const target = await getPrisma().user.create({
      data: {
        name: "Promo",
        email: `promo-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    const liveCookie = await cookieFor({ ...target, tokenVersion: 0 });
    const response = await teamPatch(
      req("PATCH", `/api/admin/team/${target.id}`, await cookieFor(admin), { role: "ADMIN" }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(response.status).toBe(200);
    const row = await getPrisma().user.findUnique({ where: { id: target.id } });
    expect(row?.role).toBe("ADMIN");
    // Role change takes effect without session revocation.
    expect(row?.tokenVersion).toBe(0);
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.TEAM_MEMBER_ROLE_CHANGED, entityId: target.id },
    });
    expect(audit?.userId).toBe(admin.id);
    expect(audit?.detail).toMatchObject({ from: "RECEPTIONIST", to: "ADMIN" });
    // The promoted member's existing session now passes the ADMIN gate.
    expect((await teamList(req("GET", "/api/admin/team", liveCookie))).status).toBe(200);
  });

  it("reactivates staff with a tokenVersion bump and from/to audit detail", async () => {
    const admin = await createStaff(Role.ADMIN);
    const target = await getPrisma().user.create({
      data: {
        name: "Revive",
        email: `revive-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
        active: false,
        tokenVersion: 1,
      },
    });
    const response = await teamPatch(
      req("PATCH", `/api/admin/team/${target.id}`, await cookieFor(admin), { active: true }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(response.status).toBe(200);
    const row = await getPrisma().user.findUnique({ where: { id: target.id } });
    expect(row?.active).toBe(true);
    expect(row?.tokenVersion).toBe(2);
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.TEAM_MEMBER_DEACTIVATED, entityId: target.id },
    });
    expect(audit?.detail).toMatchObject({ from: false, to: true });
  });

  it("refuses self-deactivation and self-demotion with exact codes", async () => {
    const admin = await createStaff(Role.ADMIN);
    // A second admin exists, so the self guards (not LAST_ADMIN) fire.
    await getPrisma().user.create({
      data: {
        name: "Second",
        email: `second-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.ADMIN,
      },
    });
    const cookie = await cookieFor(admin);
    const off = await teamPatch(
      req("PATCH", `/api/admin/team/${admin.id}`, cookie, { active: false }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(off.status).toBe(400);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe(
      "CANNOT_DEACTIVATE_SELF",
    );
    const down = await teamPatch(
      req("PATCH", `/api/admin/team/${admin.id}`, cookie, { role: "RECEPTIONIST" }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(down.status).toBe(400);
    expect(((await down.json()) as { error: { code: string } }).error.code).toBe(
      "CANNOT_DEMOTE_SELF",
    );
  });

  it("refuses to remove the last active ADMIN privilege (LAST_ADMIN)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    // Lone admin: self-deactivation reports LAST_ADMIN (clinic lockout
    // matters more than the self rule).
    const loneOff = await teamPatch(
      req("PATCH", `/api/admin/team/${admin.id}`, cookie, { active: false }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(loneOff.status).toBe(400);
    expect(((await loneOff.json()) as { error: { code: string } }).error.code).toBe("LAST_ADMIN");
    // Lone admin: self-demotion reports LAST_ADMIN too.
    const loneDown = await teamPatch(
      req("PATCH", `/api/admin/team/${admin.id}`, cookie, { role: "RECEPTIONIST" }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(loneDown.status).toBe(400);
    expect(((await loneDown.json()) as { error: { code: string } }).error.code).toBe("LAST_ADMIN");
    // With two admins, removing one privilege works…
    const second = await getPrisma().user.create({
      data: {
        name: "Second",
        email: `second-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.ADMIN,
      },
    });
    const downSecond = await teamPatch(
      req("PATCH", `/api/admin/team/${second.id}`, cookie, { role: "RECEPTIONIST" }),
      { params: Promise.resolve({ id: second.id }) },
    );
    expect(downSecond.status).toBe(200);
    // …and the clinic still retains exactly one active admin afterwards.
    expect(
      await getPrisma().user.count({ where: { role: Role.ADMIN, active: true } }),
    ).toBe(1);
  });

  it("400s on an empty body or an unknown id", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const target = await getPrisma().user.create({
      data: {
        name: "Vide",
        email: `vide-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    expect(
      (
        await teamPatch(req("PATCH", `/api/admin/team/${target.id}`, cookie, {}), {
          params: Promise.resolve({ id: target.id }),
        })
      ).status,
    ).toBe(400);
    const missing = await teamPatch(
      req("PATCH", "/api/admin/team/does-not-exist", cookie, { name: "X" }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("name-only edit changes nothing auditable", async () => {
    const admin = await createStaff(Role.ADMIN);
    const target = await getPrisma().user.create({
      data: {
        name: "Ancien",
        email: `ancien-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    const response = await teamPatch(
      req("PATCH", `/api/admin/team/${target.id}`, await cookieFor(admin), { name: "Nouveau" }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(response.status).toBe(200);
    expect((await getPrisma().user.findUnique({ where: { id: target.id } }))?.name).toBe("Nouveau");
    expect(
      await getPrisma().auditLog.count({
        where: { entityType: "User", entityId: target.id },
      }),
    ).toBe(0);
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
    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.PASSWORD_RESET, entityId: target.id },
    });
    expect(audit?.userId).toBe(admin.id);
    expect(audit?.detail).toMatchObject({ forced: true });
    expect(JSON.stringify(audit?.detail)).not.toContain("ResetPassword-2026-New");
  });

  it("rejects weak reset passwords and self-reset, 404s unknown ids", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const target = await getPrisma().user.create({
      data: {
        name: "Faible",
        email: `faible-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    const weak = await teamReset(
      req("POST", `/api/admin/team/${target.id}/reset-password`, cookie, { newPassword: "short" }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as { error: { code: string } }).error.code).toBe("WEAK_PASSWORD");
    expect((await getPrisma().user.findUnique({ where: { id: target.id } }))?.tokenVersion).toBe(0);
    expect(
      await getPrisma().auditLog.count({ where: { action: AuditAction.PASSWORD_RESET } }),
    ).toBe(0);
    // No self-reset: your own password rotates via change-password instead.
    const self = await teamReset(
      req("POST", `/api/admin/team/${admin.id}/reset-password`, cookie, {
        newPassword: "ResetPassword-2026-New",
      }),
      { params: Promise.resolve({ id: admin.id }) },
    );
    expect(self.status).toBe(400);
    expect(((await self.json()) as { error: { code: string } }).error.code).toBe(
      "CANNOT_RESET_SELF",
    );
    const missing = await teamReset(
      req("POST", "/api/admin/team/does-not-exist/reset-password", cookie, {
        newPassword: "ResetPassword-2026-New",
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("reset temp password logs in, then must be rotated via change-password", async () => {
    const admin = await createStaff(Role.ADMIN);
    const email = `cycle-${Math.random().toString(36).slice(2)}@test.com`;
    const created = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {
        name: "Cycle",
        email,
        password: "TempPassword-2026-Secure",
      }),
    );
    const targetId = ((await created.json()) as { user: { id: string } }).user.id;
    await teamReset(
      req("POST", `/api/admin/team/${targetId}/reset-password`, await cookieFor(admin), {
        newPassword: "ResetTemp-2026-Second",
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    // Login with the temp password succeeds and reports mustChangePassword.
    const loggedIn = await login(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "ResetTemp-2026-Second" }),
      }),
    );
    expect(loggedIn.status).toBe(200);
    expect(((await loggedIn.clone().json()) as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);
    const sessionCookie = loggedIn.headers.get("Set-Cookie")!;
    // Rotation via change-password clears the flag; the temp stops working.
    const rotated = await changePassword(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: "ResetTemp-2026-Second",
          newPassword: "FinalPassword-2026-Rotated",
        }),
      }),
    );
    expect(rotated.status).toBe(200);
    expect(
      (await getPrisma().user.findUnique({ where: { id: targetId } }))?.mustChangePassword,
    ).toBe(false);
    const stale = await login(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "ResetTemp-2026-Second" }),
      }),
    );
    expect(stale.status).toBe(401);
  });

  it("reset unlocks a locked account", async () => {
    const admin = await createStaff(Role.ADMIN);
    const email = `locked-${Math.random().toString(36).slice(2)}@test.com`;
    const created = await teamCreate(
      req("POST", "/api/admin/team", await cookieFor(admin), {
        name: "Locked",
        email,
        password: "TempPassword-2026-Secure",
      }),
    );
    const targetId = ((await created.json()) as { user: { id: string } }).user.id;
    await getPrisma().user.update({
      where: { id: targetId },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    });
    const response = await teamReset(
      req("POST", `/api/admin/team/${targetId}/reset-password`, await cookieFor(admin), {
        newPassword: "UnlockPassword-2026-New",
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    expect(response.status).toBe(200);
    const row = await getPrisma().user.findUnique({ where: { id: targetId } });
    expect(row?.failedLoginCount).toBe(0);
    expect(row?.lockedUntil).toBeNull();
    const loggedIn = await login(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "UnlockPassword-2026-New" }),
      }),
    );
    expect(loggedIn.status).toBe(200);
  });
});
