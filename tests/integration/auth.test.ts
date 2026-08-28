import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";

// Task 12 — route-level auth flow (plan.md §Auth/RBAC):
//   throttled + lockout-protected login, audited success/failure/lockout,
//   logout, /me, forced + voluntary password change with tokenVersion bump.

const STRONG = "correct horse battery";

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(overrides: Partial<{ role: Role; active: boolean; mustChangePassword: boolean }> = {}) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `auth-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: await hashPassword(STRONG),
      role: overrides.role ?? Role.RECEPTIONIST,
      active: overrides.active ?? true,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
}

function loginRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function cookieValueFrom(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

async function lastAudit(action: AuditAction) {
  return getPrisma().auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: "desc" },
  });
}

describe("POST /api/auth/login", () => {
  it("logs a staff member in, sets the session cookie, and audits LOGIN_SUCCESS", async () => {
    const user = await createStaff();
    const response = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    expect(response.status).toBe(200);

    const cookie = cookieValueFrom(response);
    expect(cookie).toBeTruthy();
    const payload = await verifySessionToken(cookie);
    expect(payload?.userId).toBe(user.id);
    expect(payload?.role).toBe(Role.RECEPTIONIST);

    const body = (await response.json()) as { user: { id: string; role: string; mustChangePassword: boolean } };
    expect(body.user.id).toBe(user.id);
    expect(body.user.mustChangePassword).toBe(false);

    const audit = await lastAudit(AuditAction.LOGIN_SUCCESS);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(user.id);
  });

  it("rejects a wrong password with a generic 401 and audits LOGIN_FAILED", async () => {
    const user = await createStaff();
    const response = await loginRoute(loginRequest({ email: user.email, password: "wrong password!!" }));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CREDENTIALS");

    const audit = await lastAudit(AuditAction.LOGIN_FAILED);
    expect(audit?.userId).toBe(user.id);

    const dbUser = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(dbUser?.failedLoginCount).toBe(1);
  });

  it("locks the account after 5 consecutive failures and audits LOGIN_LOCKED", async () => {
    const user = await createStaff();
    for (let i = 0; i < 5; i++) {
      await loginRoute(loginRequest({ email: user.email, password: "wrong password!!" }));
    }
    const dbUser = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(dbUser?.lockedUntil).toBeTruthy();
    expect(dbUser?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const lockedAudit = await lastAudit(AuditAction.LOGIN_LOCKED);
    expect(lockedAudit?.userId).toBe(user.id);

    // Even the CORRECT password is rejected while the lock is active.
    const response = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    expect(response.status).toBe(401);
  });

  it("rejects a deactivated account with a generic 401", async () => {
    const user = await createStaff({ active: false });
    const response = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("responds 429 when the per-ACCOUNT login rate limit is exceeded", async () => {
    const user = await createStaff();
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await loginRoute(
        loginRequest({ email: user.email, password: `wrong password ${i}!` }),
      );
    }
    expect(last?.status).toBe(429);
  });

  it("rejects a mismatched Origin header with 403 (CSRF)", async () => {
    const user = await createStaff();
    const response = await loginRoute(
      loginRequest(
        { email: user.email, password: STRONG },
        { origin: "http://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an invalid payload with 400", async () => {
    const response = await loginRoute(loginRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
  });

  it("responds with the hardened __Host- cookie attributes on the real response", async () => {
    const user = await createStaff();
    const response = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("returns the same generic 401 for a non-existent account (no enumeration by message)", async () => {
    const response = await loginRoute(
      loginRequest({ email: "nobody@nowhere.test", password: "whatever-pass-123" }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("locks the account even under a CONCURRENT burst of bad logins (atomic counter)", async () => {
    const user = await createStaff();
    const attempts = Array.from({ length: 10 }, (_, i) =>
      loginRoute(loginRequest({ email: user.email, password: `wrong pass ${i}!!` })),
    );
    const responses = await Promise.all(attempts);
    // Every attempt is rejected…
    expect(responses.every((r) => r.status === 401)).toBe(true);
    // …and the account still ends up locked (read-modify-write would have
    // let parallel updates overwrite each other and never reach 5).
    const dbUser = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(dbUser?.lockedUntil).toBeTruthy();
    expect(dbUser?.failedLoginCount).toBeGreaterThanOrEqual(5);
  });

  it("resets the failure counter when a lock EXPIRES (no indefinite one-attempt-per-15min)", async () => {
    const user = await createStaff();
    const prisma = getPrisma();
    // Simulate a lock that expired 1 minute ago, with the counter still at 5.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() - 60 * 1000),
      },
    });

    // First attempt after expiry: a failure, but the counter restarts.
    await loginRoute(loginRequest({ email: user.email, password: "wrong password!!" }));
    const afterOne = await prisma.user.findUnique({ where: { id: user.id } });
    expect(afterOne?.failedLoginCount).toBe(1);
    expect(afterOne?.lockedUntil).toBeNull();

    // Four more failures reach the threshold again → fresh lock.
    for (let i = 0; i < 4; i++) {
      await loginRoute(loginRequest({ email: user.email, password: "wrong password!!" }));
    }
    const afterFive = await prisma.user.findUnique({ where: { id: user.id } });
    expect(afterFive?.lockedUntil).toBeTruthy();
  });

  it("throttles by IP when a trusted proxy header is present (per-IP bucket, fresh accounts)", async () => {
    // 21 different accounts, same trusted IP → the 21st hits the IP bucket
    // (20/5min). "not-a-hash" makes argon2.verify fail fast (no real hash to
    // burn) so the test stays quick.
    const passwordHash = "not-a-valid-hash";
    const makeFastUser = () =>
      getPrisma().user.create({
        data: {
          name: "IP Flood",
          email: `ipflood-${Math.random().toString(36).slice(2)}@test.com`,
          passwordHash,
          role: Role.RECEPTIONIST,
        },
      });
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      const u = await makeFastUser();
      last = await loginRoute(
        loginRequest(
          { email: u.email, password: "whatever-pass-123" },
          { "x-real-ip": "203.0.113.7" },
        ),
      );
      if (i < 20) expect(last.status).toBe(401);
    }
    expect(last?.status).toBe(429);

    // A request WITHOUT the trusted header is not caught by that IP bucket
    // (no shared "unknown" bucket) — it gets the normal 401 path.
    const fresh = await makeFastUser();
    const withoutIp = await loginRoute(
      loginRequest({ email: fresh.email, password: "whatever-pass-123" }),
    );
    expect(withoutIp.status).toBe(401);
  }, 15000);
});

describe("GET /api/auth/me", () => {
  it("returns the current staff user for a valid session", async () => {
    const user = await createStaff();
    const login = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    const cookie = cookieValueFrom(login);
    const response = await meRoute(
      new NextRequest("http://localhost:3000/api/auth/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string } };
    expect(body.user.email).toBe(user.email);
  });

  it("returns 401 without a session", async () => {
    const response = await meRoute(new NextRequest("http://localhost:3000/api/auth/me"));
    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and audits LOGOUT", async () => {
    const user = await createStaff();
    const login = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    const cookie = cookieValueFrom(login);
    const response = await logoutRoute(
      new NextRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    const audit = await lastAudit(AuditAction.LOGOUT);
    expect(audit?.userId).toBe(user.id);
  });
});

describe("POST /api/auth/change-password", () => {
  async function loginAndGetCookie(user: { email: string }) {
    const login = await loginRoute(loginRequest({ email: user.email, password: STRONG }));
    return cookieValueFrom(login)!;
  }

  it("changes the password, bumps tokenVersion (revokes old sessions), clears mustChangePassword, audits PASSWORD_RESET", async () => {
    const user = await createStaff({ mustChangePassword: true });
    const oldCookie = await loginAndGetCookie(user);

    const response = await changePasswordRoute(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${oldCookie}`,
        },
        body: JSON.stringify({ currentPassword: STRONG, newPassword: "brand new password 42" }),
      }),
    );
    expect(response.status).toBe(200);

    const dbUser = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(dbUser?.mustChangePassword).toBe(false);
    expect(dbUser?.tokenVersion).toBe(1);

    // Old session revoked…
    const oldSession = await verifySessionToken(oldCookie);
    // (the token itself is still signed, but the guard would reject it on
    // tokenVersion mismatch — asserted via /me below)
    expect(oldSession?.tokenVersion).toBe(0);
    const meOld = await meRoute(
      new NextRequest("http://localhost:3000/api/auth/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${oldCookie}` },
      }),
    );
    expect(meOld.status).toBe(401);

    // …and the new cookie issued by the change works.
    const newCookie = cookieValueFrom(response)!;
    const meNew = await meRoute(
      new NextRequest("http://localhost:3000/api/auth/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${newCookie}` },
      }),
    );
    expect(meNew.status).toBe(200);

    const audit = await lastAudit(AuditAction.PASSWORD_RESET);
    expect(audit?.userId).toBe(user.id);
  });

  it("rejects a wrong current password", async () => {
    const user = await createStaff();
    const cookie = await loginAndGetCookie(user);
    const response = await changePasswordRoute(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        },
        body: JSON.stringify({ currentPassword: "wrong password!!", newPassword: "brand new password 42" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a weak new password with the policy reason", async () => {
    const user = await createStaff();
    const cookie = await loginAndGetCookie(user);
    const response = await changePasswordRoute(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        },
        body: JSON.stringify({ currentPassword: STRONG, newPassword: "123456789012" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/courant/i);
  });

  it("throttles current-password guessing (429 after 10 attempts/5min)", async () => {
    const user = await createStaff();
    const cookie = await loginAndGetCookie(user);
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await changePasswordRoute(
        new NextRequest("http://localhost:3000/api/auth/change-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          },
          body: JSON.stringify({ currentPassword: `wrong password ${i}!`, newPassword: "brand new password 42" }),
        }),
      );
    }
    expect(last?.status).toBe(429);
  });

  it("requires a session (401)", async () => {
    const response = await changePasswordRoute(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: STRONG, newPassword: "brand new password 42" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("a mustChangePassword session is blocked from admin routes but can still rotate", async () => {
    const { GET: adminAuditRoute } = await import("@/app/api/admin/audit/route");
    const user = await createStaff({ role: Role.ADMIN, mustChangePassword: true });
    const cookie = await loginAndGetCookie(user);

    // Admin route → 403 PASSWORD_CHANGE_REQUIRED.
    const adminResponse = await adminAuditRoute(
      new NextRequest("http://localhost:3000/api/admin/audit", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      }),
    );
    expect(adminResponse.status).toBe(403);
    const adminBody = (await adminResponse.json()) as { error: { code: string } };
    expect(adminBody.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // Rotation route still reachable…
    const changeResponse = await changePasswordRoute(
      new NextRequest("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        },
        body: JSON.stringify({ currentPassword: STRONG, newPassword: "brand new password 42" }),
      }),
    );
    expect(changeResponse.status).toBe(200);

    // …and after rotation the admin route opens up with the new cookie.
    const newCookie = cookieValueFrom(changeResponse)!;
    const unblocked = await adminAuditRoute(
      new NextRequest("http://localhost:3000/api/admin/audit", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${newCookie}` },
      }),
    );
    expect(unblocked.status).toBe(200);
  });
});
