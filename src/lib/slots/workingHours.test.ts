import { describe, it, expect } from "vitest";
import {
  getWorkingHoursForDay,
  parseHHmmToMinutes,
  isValidDayConfig,
} from "./workingHours";

describe("workingHours", () => {
  const settingValue = {
    sat: { open: "10:00", close: "17:00" },
    sun: { open: "10:30", close: "16:45" },
    fri: { closed: true },
  };

  it("returns open and close minutes from midnight for a normal day", () => {
    // 2026-08-22 is a Saturday
    const hours = getWorkingHoursForDay("2026-08-22", settingValue);
    expect(hours).toEqual({ openMinutes: 600, closeMinutes: 1020 });
  });

  it("returns null for a closed day", () => {
    // 2026-08-28 is a Friday
    const hours = getWorkingHoursForDay("2026-08-28", settingValue);
    expect(hours).toBeNull();
  });

  it("returns null if the day is missing from the setting", () => {
    // 2026-08-24 is a Monday, missing from our settingValue
    const hours = getWorkingHoursForDay("2026-08-24", settingValue);
    expect(hours).toBeNull();
  });

  it("returns null and does not throw when the setting is not an object", () => {
    expect(getWorkingHoursForDay("2026-08-25", null)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-25", undefined)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-25", "garbage")).toBeNull();
    expect(getWorkingHoursForDay("2026-08-25", 42)).toBeNull();
  });

  it("returns null when the day entry is malformed", () => {
    const malformed = {
      // sat is a string instead of {open, close}
      sat: "10:00-17:00",
      // sun has a bad HH:mm value
      sun: { open: "bad", close: "16:00" },
      // mon is missing close
      mon: { open: "10:00" },
      // tue has swapped types
      tue: { open: 600, close: 1020 },
      // wed has closed=false (open hours expected)
      wed: { closed: false },
    };
    expect(getWorkingHoursForDay("2026-08-22", malformed)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-23", malformed)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-24", malformed)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-25", malformed)).toBeNull();
    expect(getWorkingHoursForDay("2026-08-26", malformed)).toBeNull();
  });

  describe("isValidDayConfig", () => {
    it("accepts a properly-formed open/close day", () => {
      expect(isValidDayConfig({ open: "10:00", close: "17:00" })).toBe(true);
    });

    it("accepts a closed day", () => {
      expect(isValidDayConfig({ closed: true })).toBe(true);
    });

    it("rejects anything else", () => {
      expect(isValidDayConfig(null)).toBe(false);
      expect(isValidDayConfig(undefined)).toBe(false);
      expect(isValidDayConfig("10:00")).toBe(false);
      expect(isValidDayConfig({ open: "10:00" })).toBe(false); // missing close
      expect(isValidDayConfig({ open: 600, close: 1020 })).toBe(false); // wrong types
      expect(isValidDayConfig({ open: "25:00", close: "17:00" })).toBe(false); // bad HH
      expect(isValidDayConfig({ open: "10:00", close: "9:00" })).toBe(false); // close <= open
    });
  });

  describe("parseHHmmToMinutes", () => {
    it("parses HH:mm strings", () => {
      expect(parseHHmmToMinutes("00:00")).toBe(0);
      expect(parseHHmmToMinutes("10:30")).toBe(630);
      expect(parseHHmmToMinutes("23:59")).toBe(1439);
    });

    it("returns NaN for malformed input (callers must validate)", () => {
      expect(Number.isNaN(parseHHmmToMinutes("bad"))).toBe(true);
      expect(Number.isNaN(parseHHmmToMinutes("10"))).toBe(true);
    });
  });
});
