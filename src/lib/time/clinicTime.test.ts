import { describe, it, expect } from "vitest";
import {
  addClinicDays,
  clinicNoon,
  formatClinicLocalTime,
} from "./clinicTime";

describe("formatClinicLocalTime", () => {
  it("formats a UTC instant as clinic-local HH:mm (Africa/Algiers, UTC+1)", () => {
    // 09:00 UTC == 10:00 local
    expect(formatClinicLocalTime(new Date("2026-08-25T09:00:00.000Z"))).toBe(
      "10:00",
    );
  });

  it("handles the day boundary: 23:30 UTC == 00:30 local the next day", () => {
    expect(formatClinicLocalTime(new Date("2026-08-25T23:30:00.000Z"))).toBe(
      "00:30",
    );
  });

  it("pads single-digit hours", () => {
    // 07:05 UTC == 08:05 local
    expect(formatClinicLocalTime(new Date("2026-08-25T07:05:00.000Z"))).toBe(
      "08:05",
    );
  });
});

describe("addClinicDays", () => {
  it("returns the clinic-local date n days later, crossing a month boundary", () => {
    expect(addClinicDays("2026-08-25", 1)).toBe("2026-08-26");
    expect(addClinicDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addClinicDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles 0 and negative day offsets", () => {
    expect(addClinicDays("2026-08-25", 0)).toBe("2026-08-25");
    expect(addClinicDays("2026-08-25", -1)).toBe("2026-08-24");
  });
});

describe("clinicNoon", () => {
  it("returns the noon instant of the clinic-local day (11:00 UTC for +01:00)", () => {
    expect(clinicNoon("2026-08-25").toISOString()).toBe(
      "2026-08-25T11:00:00.000Z",
    );
  });
});