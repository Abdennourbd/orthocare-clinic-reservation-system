import { describe, it, expect } from "vitest";
import { getClientIp } from "./clientIp";

function headers(
  obj: Record<string, string | string[] | undefined>,
): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) h.append(k, v.join(","));
    else if (v !== undefined) h.set(k, v);
  }
  return h;
}

describe("getClientIp", () => {
  it("prefers the trusted x-real-ip header", () => {
    const h = headers({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });
    expect(getClientIp(h)).toBe("203.0.113.7");
  });

  it("takes the leftmost value of x-vercel-forwarded-for", () => {
    const h = headers({
      "x-vercel-forwarded-for": "198.51.100.5, 198.51.100.9",
    });
    expect(getClientIp(h)).toBe("198.51.100.5");
  });

  it("ignores a forged x-forwarded-for when trustForwardedFor is off (default)", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.66" });
    expect(getClientIp(h)).toBeNull();
  });

  it("uses x-forwarded-for only when trustForwardedFor is enabled", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.66" });
    expect(getClientIp(h, { trustForwardedFor: true })).toBe("198.51.100.66");
  });

  it("returns null when no trusted header is present", () => {
    expect(getClientIp(headers({}))).toBeNull();
  });

  it("accepts a plain object headers map as well as a Headers instance", () => {
    expect(
      getClientIp({ "x-real-ip": "203.0.113.9" } as Record<
        string,
        string | undefined
      >),
    ).toBe("203.0.113.9");
    expect(getClientIp({ "x-forwarded-for": "203.0.113.9" })).toBeNull();
  });
});
