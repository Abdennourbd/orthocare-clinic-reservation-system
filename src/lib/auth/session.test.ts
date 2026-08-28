import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  createSessionCookieHeader,
  clearSessionCookieHeader,
  type SessionPayload,
} from "./session";

// Task 12 — signed session cookie (plan.md §Auth/RBAC):
//   HttpOnly, Secure, SameSite=Lax, __Host- prefix, signed (HMAC-SHA256),
//   absolute expiry 12h, idle expiry 2h, carries tokenVersion so a bump
//   invalidates live sessions.

beforeAll(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.useRealTimers();
});

const BASE: Omit<SessionPayload, "iat" | "lastActive"> = {
  userId: "user_1",
  role: "RECEPTIONIST",
  tokenVersion: 0,
};

describe("createSessionToken / verifySessionToken", () => {
  it("round-trips a valid token", async () => {
    const token = await createSessionToken(BASE);
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user_1");
    expect(payload?.role).toBe("RECEPTIONIST");
    expect(payload?.tokenVersion).toBe(0);
  });

  it("rejects a tampered token (bad signature)", async () => {
    const token = await createSessionToken(BASE);
    const [body] = token.split(".");
    const tampered = `${body}.deadbeef`;
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(BASE);
    vi.stubEnv("SESSION_SECRET", "another-secret-entirely");
    expect(await verifySessionToken(token)).toBeNull();
    vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  });

  it("rejects an expired token (absolute 12h expiry)", async () => {
    const token = await createSessionToken(BASE);
    const after12h = new Date(Date.now() + 13 * 60 * 60 * 1000);
    vi.useFakeTimers({ now: after12h });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects a token idle beyond 2h", async () => {
    const token = await createSessionToken(BASE);
    const after2h1min = new Date(Date.now() + 121 * 60 * 1000);
    vi.useFakeTimers({ now: after2h1min });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("accepts a token idle just under 2h", async () => {
    const token = await createSessionToken(BASE);
    const after1h59 = new Date(Date.now() + 119 * 60 * 1000);
    vi.useFakeTimers({ now: after1h59 });
    expect(await verifySessionToken(token)).not.toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("not-a-token")).toBeNull();
  });

  it("does NOT reset the absolute expiry when refreshed (iat propagated)", async () => {
    // Login happened 11h ago…
    const elevenHoursAgo = Date.now() - 11 * 60 * 60 * 1000;
    const refreshedCookie = await createSessionCookieHeader({ ...BASE, iat: elevenHoursAgo });
    const token = refreshedCookie.split(";")[0].split("=")[1];

    // …activity now is still fine (within 12h of LOGIN, under 2h idle).
    expect(await verifySessionToken(token)).not.toBeNull();
    // Max-Age reflects the REMAINING absolute life (~1h), not a fresh 12h.
    expect(refreshedCookie).toMatch(/Max-Age=(?:35[0-9]{2}|36[0-9]{2})/);

    // …but 13h after the ORIGINAL login the refreshed session is dead even
    // with continuous activity under the 2h idle window.
    vi.useFakeTimers({ now: new Date(Date.now() + 13 * 60 * 60 * 1000) });
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("cookie headers", () => {
  it("sets a __Host- prefixed cookie with hardening attributes", async () => {
    const header = await createSessionCookieHeader(BASE);
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Domain=");
  });

  it("clear cookie removes the session cookie", () => {
    const header = clearSessionCookieHeader();
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
    expect(header).toContain("Max-Age=0");
  });
});
