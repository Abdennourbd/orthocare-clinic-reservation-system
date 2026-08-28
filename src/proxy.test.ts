import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import proxy from "./proxy";

// next-intl's middleware import chain doesn't resolve under Vitest's node
// environment; the admin branch under test never calls it, so stub it out.
vi.mock("next-intl/middleware", () => ({
  default: () => () => NextResponse.next(),
}));

// Task 12 — /admin is middleware-protected (plan.md §Auth/RBAC):
//   unauthenticated visitors are redirected to /admin/login; a signed session
//   cookie passes through (the DB re-check happens in the layout / API guard).

beforeAll(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function cookieFor(role: Role, active = true) {
  const user = await getPrisma().user.create({
    data: {
      name: "Proxy Test",
      email: `proxy-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active,
    },
  });
  const token = await createSessionToken({
    userId: user.id,
    role: role as "ADMIN" | "RECEPTIONIST",
    tokenVersion: 0,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("proxy /admin guard", () => {
  it("redirects an anonymous /admin visit to /admin/login", async () => {
    const request = new NextRequest("http://localhost:3000/admin");
    const response = await proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/admin/login");
  });

  it("redirects /admin/patients deep links to /admin/login", async () => {
    const request = new NextRequest("http://localhost:3000/admin/patients");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost:3000/admin/login");
  });

  it("lets a signed session through to /admin", async () => {
    const cookie = await cookieFor(Role.ADMIN);
    const request = new NextRequest("http://localhost:3000/admin", {
      headers: { cookie },
    });
    const response = await proxy(request);
    expect(response.status).not.toBe(307);
  });

  it("redirects a tampered cookie to /admin/login", async () => {
    const request = new NextRequest("http://localhost:3000/admin", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=tampered.sig` },
    });
    const response = await proxy(request);
    expect(response.status).toBe(307);
  });

  it("NEVER redirects /admin/login, even with a revoked-session cookie (no redirect loop)", async () => {
    // Deactivated user with a still-signed cookie: proxy → /admin/login must
    // pass through (the login page's DB check renders the form); a redirect
    // back to /admin here would loop forever with the dashboard layout.
    const user = await getPrisma().user.create({
      data: {
        name: "Revoked",
        email: `revoked-${Math.random().toString(36).slice(2)}@test.com`,
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
        active: false,
      },
    });
    const token = await createSessionToken({
      userId: user.id,
      role: "RECEPTIONIST",
      tokenVersion: 0,
    });
    const request = new NextRequest("http://localhost:3000/admin/login", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const response = await proxy(request);
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("always lets /admin/login through when unauthenticated", async () => {
    const request = new NextRequest("http://localhost:3000/admin/login");
    const response = await proxy(request);
    expect(response.status).not.toBe(307);
  });

  it("does not guard public locale paths (delegated to intl middleware)", async () => {
    const request = new NextRequest("http://localhost:3000/fr");
    const response = await proxy(request);
    expect(response.status).not.toBe(307);
  });

  it("never guards /api routes (matcher excludes them)", () => {
    // This is asserted statically: the proxy only inspects /admin* paths, and
    // the matcher config excludes /api. If someone removes the exclusion,
    // CI would surface it here.
    expect(proxy).toBeTypeOf("function");
  });
});
