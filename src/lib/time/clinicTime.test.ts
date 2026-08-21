import { describe, it, expect } from "vitest";
import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
  getClinicDayOfWeek,
  CLINIC_UTC_OFFSET_MINUTES,
} from "./clinicTime";

describe("clinicTime", () => {
  it("getClinicDayBoundsUTC returns correct UTC bounds for a local date", () => {
    // Algiers is UTC+1. So 2026-08-25 local 00:00 is 2026-08-24 23:00 UTC.
    const bounds = getClinicDayBoundsUTC("2026-08-25");
    
    expect(bounds.startUTC.toISOString()).toBe("2026-08-24T23:00:00.000Z");
    expect(bounds.endUTC.toISOString()).toBe("2026-08-25T22:59:59.999Z");
  });

  it("toClinicLocalDateString converts a UTC date to the clinic's local YYYY-MM-DD", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in Algiers.
    const utcDate = new Date("2026-08-24T23:30:00.000Z");
    expect(toClinicLocalDateString(utcDate)).toBe("2026-08-25");

    // 22:30 UTC on the 24th is 23:30 on the 24th in Algiers.
    const utcDate2 = new Date("2026-08-24T22:30:00.000Z");
    expect(toClinicLocalDateString(utcDate2)).toBe("2026-08-24");
  });

  it("getClinicDayOfWeek returns the correct 3-letter lowercase day name", () => {
    // 2026-08-25 is a Tuesday.
    expect(getClinicDayOfWeek("2026-08-25")).toBe("tue");
    // 2026-08-28 is a Friday.
    expect(getClinicDayOfWeek("2026-08-28")).toBe("fri");
  });

  it("CLINIC_UTC_OFFSET_MINUTES is +60 (Africa/Algiers, no DST)", () => {
    expect(CLINIC_UTC_OFFSET_MINUTES).toBe(60);
  });
});

