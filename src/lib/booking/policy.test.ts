import { describe, expect, it } from "vitest";
import { getPrisma } from "@/lib/db";
import { readBookingPolicy, readConsentVersion } from "./policy";

describe("readBookingPolicy", () => {
  it("returns documented defaults when the Setting is missing", async () => {
    expect(await readBookingPolicy()).toEqual({
      pendingExpiryHours: 24,
      minLeadTimeMinutes: 120,
      maxHorizonDays: 90,
      clinicTimezone: "Africa/Algiers",
    });
  });

  it("falls back field-wise on partial or wrongly-typed values", async () => {
    await getPrisma().setting.create({
      data: {
        key: "bookingPolicy",
        value: { pendingExpiryHours: 48, minLeadTimeMinutes: "soon" },
      },
    });
    expect(await readBookingPolicy()).toEqual({
      pendingExpiryHours: 48,
      minLeadTimeMinutes: 120,
      maxHorizonDays: 90,
      clinicTimezone: "Africa/Algiers",
    });
  });
});

describe("readConsentVersion", () => {
  it("returns 1.0 when the Setting is missing", async () => {
    expect(await readConsentVersion()).toBe("1.0");
  });

  it("reads string, {version} object, and falls back on empty", async () => {
    await getPrisma().setting.create({
      data: { key: "consentVersion", value: "2.3" },
    });
    expect(await readConsentVersion()).toBe("2.3");

    await getPrisma().setting.update({
      where: { key: "consentVersion" },
      data: { value: { version: "3.0" } },
    });
    expect(await readConsentVersion()).toBe("3.0");

    await getPrisma().setting.update({
      where: { key: "consentVersion" },
      data: { value: "" },
    });
    expect(await readConsentVersion()).toBe("1.0");
  });
});
