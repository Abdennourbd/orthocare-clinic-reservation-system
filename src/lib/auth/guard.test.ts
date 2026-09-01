import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import {
  requireStaff,
  assertSameOriginStrict,
} from "./guard";
import { createSessionToken, SESSION_COOKIE_NAME } from "./session";

// Task 12 — request guard for /api/admin/* (plan.md §Auth/RBAC + §CSRF):
//   session verified, user looked up (active + tokenVersion match), roles
//   enforced; state-changing requests reject a mismatched Origin/Referer.

beforeAll(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

async function createStaff(overrides: {
  role?: Role;
  active?: boolean;
  tokenVersion?: number;
}) {
  return getPrisma().user.create({
    data: {
      name: "Staff",
      email: `guard-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role: overrides.role ?? Role.RECEPTIONIST,
      active: overrides.active ?? true,
      tokenVersion: overrides.tokenVersion ?? 0,
    },
  });
}

async function requestWithSession(
  userId: string,
  tokenVersion: number,
): Promise<NextRequest> {
  const token = await createSessionToken({
    userId,
    role: Role.RECEPTIONIST,
    tokenVersion,
  });
  return new NextRequest("http://localhost:3000/api/admin/audit", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

describe("requireStaff", () => {
  it("accepts a valid session and returns the user", async () => {
    const user = await createStaff({});
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(user.id);
      expect(result.refreshCookie).toContain(SESSION_COOKIE_NAME);
    }
  });

  it("rejects an anonymous request with 401", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/audit");
    const result = await requireStaff(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a deactivated user (active=false) with 401", async () => {
    const user = await createStaff({ active: false });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a session whose tokenVersion is behind the DB (revoked)", async () => {
    const user = await createStaff({ tokenVersion: 1 });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("enforces role gating: receptionist fails an ADMIN-only route with 403", async () => {
    const user = await createStaff({ role: Role.RECEPTIONIST });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request, { roles: ["ADMIN"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows an admin through an ADMIN-only route", async () => {
    const user = await createStaff({ role: Role.ADMIN });
    const token = await createSessionToken({
      userId: user.id,
      role: "ADMIN",
      tokenVersion: 0,
    });
    const request = new NextRequest("http://localhost:3000/api/admin/audit", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const result = await requireStaff(request, { roles: ["ADMIN"] });
    expect(result.ok).toBe(true);
  });

  it("rejects a deleted user with 401", async () => {
    const user = await createStaff({});
    const prisma = getPrisma();
    await prisma.user.delete({ where: { id: user.id } });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects an expired session with 401 (absolute expiry at guard level)", async () => {
    const user = await createStaff({});
    const request = await requestWithSession(user.id, 0);
    // Advance the clock AFTER the token was minted: 13h > 12h absolute cap.
    vi.useFakeTimers({ now: new Date(Date.now() + 13 * 60 * 60 * 1000) });
    const result = await requireStaff(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    vi.useRealTimers();
  });

  it("blocks a mustChangePassword session from admin routes (403 PASSWORD_CHANGE_REQUIRED)", async () => {
    const user = await createStaff({});
    await getPrisma().user.update({
      where: { id: user.id },
      data: { mustChangePassword: true },
    });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request, { roles: ["ADMIN"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = (await result.response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("allows a mustChangePassword session through when explicitly allowed (rotation routes)", async () => {
    const user = await createStaff({});
    await getPrisma().user.update({
      where: { id: user.id },
      data: { mustChangePassword: true },
    });
    const request = await requestWithSession(user.id, 0);
    const result = await requireStaff(request, { allowPasswordChangePending: true });
    expect(result.ok).toBe(true);
  });
});

describe("assertSameOriginStrict", () => {
  const url = "http://localhost:3000/api/admin/audit";

  it("allows a localhost Origin header regardless of APP_URL (dev/tests)", () => {
    const request = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(assertSameOriginStrict(request)).toBe(true);
  });

  it("rejects an evil Origin even in dev when APP_URL does not match it", () => {
    const request = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(assertSameOriginStrict(request)).toBe(false);
  });

  it("allows requests with no Origin and no Referer (non-browser client)", () => {
    const request = new NextRequest(url, { method: "POST" });
    expect(assertSameOriginStrict(request)).toBe(true);
  });

  it("allows a same-origin Origin header", () => {
    const request = new NextRequest(url, {
      method: "POST",
      headers: { origin: "https://orthocare.dz", host: "orthocare.dz" },
    });
    vi.stubEnv("APP_URL", "https://orthocare.dz");
    expect(assertSameOriginStrict(request)).toBe(true);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("rejects a cross-site Origin header", () => {
    const request = new NextRequest(url, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    vi.stubEnv("APP_URL", "https://orthocare.dz");
    expect(assertSameOriginStrict(request)).toBe(false);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("fails CLOSED when APP_URL is unset (rejects non-localhost origins)", () => {
    vi.stubEnv("APP_URL", "");
    const request = new NextRequest(url, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(assertSameOriginStrict(request)).toBe(false);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("allows an Origin matching the request Host header even when APP_URL is unset (deployments)", () => {
    vi.stubEnv("APP_URL", "");
    const request = new NextRequest(url, {
      method: "POST",
      headers: {
        origin: "https://orthocare-clinic.vercel.app",
        host: "orthocare-clinic.vercel.app",
      },
    });
    expect(assertSameOriginStrict(request)).toBe(true);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("rejects an Origin differing from BOTH Host header and APP_URL", () => {
    vi.stubEnv("APP_URL", "");
    const request = new NextRequest(url, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        host: "orthocare-clinic.vercel.app",
      },
    });
    expect(assertSameOriginStrict(request)).toBe(false);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("falls back to Referer when Origin is absent and rejects mismatches", () => {
    vi.stubEnv("APP_URL", "https://orthocare.dz");
    const bad = new NextRequest(url, {
      method: "POST",
      headers: { referer: "https://evil.example/form" },
    });
    expect(assertSameOriginStrict(bad)).toBe(false);
    const good = new NextRequest(url, {
      method: "POST",
      headers: { referer: "https://orthocare.dz/admin" },
    });
    expect(assertSameOriginStrict(good)).toBe(true);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });
});
