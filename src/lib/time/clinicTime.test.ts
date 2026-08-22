import { describe, it, expect } from "vitest";
import { formatClinicLocalTime, CLINIC_UTC_OFFSET_MINUTES } from "./clinicTime";

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