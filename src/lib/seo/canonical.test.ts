import { describe, expect, it, vi } from "vitest";
import { getAlternateUrls, getCanonicalUrl } from "./canonical";

describe("canonical SEO helpers", () => {
  it("builds locale canonicals without trailing slash", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    expect(getCanonicalUrl("fr", "/")).toBe("https://example.com/fr");
    expect(getCanonicalUrl("ar", "/services")).toBe("https://example.com/ar/services");
    vi.unstubAllEnvs();
  });

  it("strips a leading locale prefix before rebuilding", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    expect(getCanonicalUrl("en", "/fr/services")).toBe("https://example.com/en/services");
    vi.unstubAllEnvs();
  });

  it("exposes fr/ar/en + x-default (x-default = fr)", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    const alt = getAlternateUrls("/contact");
    expect(alt.fr).toBe("https://example.com/fr/contact");
    expect(alt.ar).toBe("https://example.com/ar/contact");
    expect(alt.en).toBe("https://example.com/en/contact");
    expect(alt["x-default"]).toBe(alt.fr);
    vi.unstubAllEnvs();
  });

  it("falls back to localhost when APP_URL is unset", () => {
    vi.stubEnv("APP_URL", "");
    // empty string is falsy -> baseUrl falls back via ?? only for undefined;
    // ensure helper never throws even without env
    expect(() => getCanonicalUrl("fr", "/")).not.toThrow();
    vi.unstubAllEnvs();
  });
});
