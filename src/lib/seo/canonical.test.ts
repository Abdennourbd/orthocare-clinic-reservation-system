import { describe, expect, it, vi, afterEach } from "vitest";
import { getAlternateUrls, getCanonicalUrl, siteBaseUrl } from "./canonical";

afterEach(() => vi.unstubAllEnvs());

describe("canonical SEO helpers", () => {
  it("builds locale canonicals without trailing slash", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    expect(getCanonicalUrl("fr", "/")).toBe("https://example.com/fr");
    expect(getCanonicalUrl("ar", "/services")).toBe("https://example.com/ar/services");
  });

  it("strips trailing-slash APP_URL (no double slash)", () => {
    vi.stubEnv("APP_URL", "https://example.com/");
    expect(getCanonicalUrl("fr", "/services")).toBe("https://example.com/fr/services");
    expect(siteBaseUrl()).toBe("https://example.com");
  });

  it("strips a leading locale prefix before rebuilding", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    expect(getCanonicalUrl("en", "/fr/services")).toBe("https://example.com/en/services");
    expect(getCanonicalUrl("fr", "/fr")).toBe("https://example.com/fr");
    expect(getCanonicalUrl("fr", "services")).toBe("https://example.com/fr/services");
  });

  it("uses a single canonical spelling (trailing slash stripped)", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    expect(getCanonicalUrl("fr", "/services/")).toBe("https://example.com/fr/services");
  });

  it("exposes fr/ar/en + x-default (x-default = fr)", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    const alt = getAlternateUrls("/contact");
    expect(alt.fr).toBe("https://example.com/fr/contact");
    expect(alt.ar).toBe("https://example.com/ar/contact");
    expect(alt.en).toBe("https://example.com/en/contact");
    expect(alt["x-default"]).toBe(alt.fr);
  });

  it("does not double-prefix an already-localized path", () => {
    vi.stubEnv("APP_URL", "https://example.com");
    const alt = getAlternateUrls("/fr/contact");
    expect(alt.fr).toBe("https://example.com/fr/contact");
    expect(alt.en).toBe("https://example.com/en/contact");
  });

  it("falls back to localhost when APP_URL is empty or unset", () => {
    vi.stubEnv("APP_URL", "");
    expect(getCanonicalUrl("fr", "/")).toBe("http://localhost:3000/fr");
    vi.stubEnv("APP_URL", "   ");
    expect(siteBaseUrl()).toBe("http://localhost:3000");
  });
});
