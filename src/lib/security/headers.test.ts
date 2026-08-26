import { describe, expect, it } from "vitest";
import { NO_REFERRER_HEADERS, SECURITY_HEADERS } from "./headers";

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

function ruleFor(rules: HeaderRule[], source: string): HeaderRule {
  const rule = rules.find((r) => r.source === source);
  if (!rule) throw new Error(`missing header rule for ${source}`);
  return rule;
}

function cspOf(rule: HeaderRule): string {
  const header = rule.headers.find((h) => h.key === "Content-Security-Policy");
  if (!header) throw new Error("missing CSP header");
  return header.value;
}

const PUBLIC_RULE = ruleFor(SECURITY_HEADERS, "/(.*)");
const TOKEN_RULE = ruleFor(
  NO_REFERRER_HEADERS,
  "/:locale/appointment/:token(.*)",
);

describe("SECURITY_HEADERS (public pages)", () => {
  it("allows the Google embed iframes (Task 10)", () => {
    const csp = cspOf(PUBLIC_RULE);
    expect(csp).toContain(
      "frame-src https://www.google.com https://maps.google.com",
    );
  });

  it("keeps the rest of the CSP strict by default", () => {
    const csp = cspOf(PUBLIC_RULE);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("NO_REFERRER_HEADERS (self-service token pages)", () => {
  it("never allow-lists Google — the token must not reach Google", () => {
    const csp = cspOf(TOKEN_RULE);
    expect(csp).not.toMatch(/google/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("sends no Referer from token pages", () => {
    expect(TOKEN_RULE.headers).toContainEqual({
      key: "Referrer-Policy",
      value: "no-referrer",
    });
  });

  it("matches the token-page route only", () => {
    expect(TOKEN_RULE.source).toBe("/:locale/appointment/:token(.*)");
  });
});