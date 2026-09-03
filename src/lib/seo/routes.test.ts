import { describe, expect, it, vi, afterEach } from "vitest";
import { LEGACY_REDIRECTS } from "./redirects";
import { getAlternateUrls } from "./canonical";
import robots from "@/app/robots";

afterEach(() => vi.unstubAllEnvs());

describe("legacy redirects", () => {
  it("maps old privacy-policy urls to /fr/privacy as permanent", () => {
    for (const source of ["/privacy-policy", "/privacy-policy/"]) {
      const rule = LEGACY_REDIRECTS.find((r) => r.source === source);
      expect(rule).toBeDefined();
      expect(rule!.destination).toBe("/fr/privacy");
      expect(rule!.permanent).toBe(true);
    }
  });
});

describe("robots", () => {
  it("allows public, disallows admin/api/token pages, points at sitemap", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const rule = rules[0] as { disallow: string[] };
    expect(rule.disallow).toContain("/admin/");
    expect(rule.disallow).toContain("/api/");
    expect(rule.disallow).toContain("/fr/appointment/");
    expect(rule.disallow).toContain("/ar/appointment/");
    expect(rule.disallow).toContain("/en/appointment/");
    expect(r.sitemap).toBe("https://example.com/sitemap.xml");
  });
});

describe("hreflang alternates", () => {
  it("every entry carries fr/ar/en + x-default", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    const alt = getAlternateUrls("/services");
    expect(Object.keys(alt).sort()).toEqual(["ar", "en", "fr", "x-default"]);
    expect(alt["x-default"]).toBe(alt.fr);
  });
});
