import { describe, it, expect } from "vitest";
import { validateWatchDates, type BookingPolicy } from "./watchDates";

const policy: BookingPolicy = {
  minLeadTimeMinutes: 120,
  maxHorizonDays: 90,
  pendingExpiryHours: 24,
  clinicTimezone: "Africa/Algiers",
};

// Fixed "now" in the middle of 2026-08-25 clinic-local (10:00 UTC = 11:00 local).
const NOW = new Date("2026-08-25T10:00:00.000Z");

describe("validateWatchDates", () => {
  it("returns null for empty / undefined watch dates", () => {
    expect(validateWatchDates([], policy, NOW)).toBeNull();
    expect(validateWatchDates(undefined, policy, NOW)).toBeNull();
  });

  it("accepts future dates within the horizon", () => {
    expect(
      validateWatchDates(["2026-08-29", "2026-08-30"], policy, NOW),
    ).toBeNull();
  });

  it("accepts today (not in the past)", () => {
    expect(validateWatchDates(["2026-08-25"], policy, NOW)).toBeNull();
  });

  it("rejects a date in the past", () => {
    expect(validateWatchDates(["2026-08-24"], policy, NOW)).toBe(
      "watch date in the past",
    );
  });

  it("rejects a date beyond the horizon", () => {
    // 2026-08-25 + 90 days ≈ 2026-11-23. 2026-11-24 is beyond it.
    expect(validateWatchDates(["2026-11-24"], policy, NOW)).toBe(
      "watch date beyond the booking horizon",
    );
  });

  it("rejects a malformed date string", () => {
    expect(validateWatchDates(["not-a-date"], policy, NOW)).toMatch(
      /YYYY-MM-DD/,
    );
  });

  it("silently dedupes repeated dates", () => {
    expect(
      validateWatchDates(["2026-08-29", "2026-08-29"], policy, NOW),
    ).toBeNull();
  });
});