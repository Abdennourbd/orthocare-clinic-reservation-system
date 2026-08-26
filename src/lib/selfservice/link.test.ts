import { describe, it, expect } from "vitest";
import { buildSelfServiceLink } from "./link";

describe("buildSelfServiceLink", () => {
  it("builds a link rooted at APP_URL with the token and locale path", () => {
    expect(buildSelfServiceLink("abc123", "ar")).toBe(
      "http://localhost:3000/ar/appointment/abc123",
    );
  });

  it("validates the locale against the allow-list (defaults to fr)", () => {
    expect(buildSelfServiceLink("tok", "xx")).toBe(
      "http://localhost:3000/fr/appointment/tok",
    );
  });

  it("strips a trailing slash from APP_URL", () => {
    expect(buildSelfServiceLink("tok", "en")).toBe(
      "http://localhost:3000/en/appointment/tok",
    );
  });
});