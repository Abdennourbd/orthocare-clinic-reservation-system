import { describe, it, expect } from "vitest";
import { localized } from "./localized";

const field = { fr: "Bonjour", ar: "مرحبا", en: "Hello" };

describe("localized", () => {
  it("returns the requested locale when present", () => {
    expect(localized(field, "ar")).toBe("مرحبا");
    expect(localized(field, "en")).toBe("Hello");
  });

  it("falls back to FR when the requested locale is missing", () => {
    expect(localized(field, "es")).toBe("Bonjour");
  });

  it("falls back to FR when the requested locale is null or empty", () => {
    const partial = { fr: "Bonjour", ar: null, en: "" };
    expect(localized(partial, "ar")).toBe("Bonjour");
    expect(localized(partial, "en")).toBe("Bonjour");
  });

  it("returns empty string when the field is null", () => {
    expect(localized(null, "fr")).toBe("");
  });

  it("returns empty string when the field has no fallback", () => {
    const noFr = { ar: "مرحبا" } as { fr: string | null; ar: string };
    expect(localized(noFr, "ar", "fr")).toBe("مرحبا");
    expect(localized(noFr, "en", "fr")).toBe("");
  });

  it("supports a custom fallback", () => {
    const onlyEn = { en: "Hello" };
    expect(localized(onlyEn, "ar", "en")).toBe("Hello");
  });
});
