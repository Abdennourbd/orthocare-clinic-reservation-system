import { describe, expect, it, vi, afterEach } from "vitest";
import { isSameSiteOrigin } from "./origin";

function post(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("isSameSiteOrigin (public write CSRF guard)", () => {
  it("allows requests with neither Origin nor Referer (non-browser clients)", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(isSameSiteOrigin(post("http://localhost/api/x"))).toBe(true);
  });

  it("allows localhost origins (dev + tests)", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(
      isSameSiteOrigin(post("http://localhost/api/x", { origin: "http://localhost:3000" })),
    ).toBe(true);
  });

  it("rejects a mismatched Origin when APP_URL is configured", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { origin: "http://evil.example" }),
      ),
    ).toBe(false);
  });

  it("accepts a matching Origin when APP_URL is configured", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { origin: "https://clinic.example" }),
      ),
    ).toBe(true);
  });

  it("accepts Host-matching Origin without APP_URL (deployment invariant)", () => {
    vi.stubEnv("APP_URL", "");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { origin: "https://clinic.example" }),
      ),
    ).toBe(true);
  });

  it("fails closed in production when APP_URL is unset and Host mismatches", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { origin: "http://evil.example" }),
      ),
    ).toBe(false);
  });

  it("stays permissive outside production when APP_URL is unset (dev/tests)", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { origin: "http://evil.example" }),
      ),
    ).toBe(true);
  });

  it("rejects malformed Origin values", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(
      isSameSiteOrigin(post("https://clinic.example/api/x", { origin: "not-a-url" })),
    ).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    vi.stubEnv("APP_URL", "https://clinic.example");
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", {
          referer: "https://clinic.example/fr/book",
        }),
      ),
    ).toBe(true);
    expect(
      isSameSiteOrigin(
        post("https://clinic.example/api/x", { referer: "http://evil.example/" }),
      ),
    ).toBe(false);
  });
});
