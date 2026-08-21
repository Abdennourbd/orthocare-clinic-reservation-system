import { describe, it, expect } from "vitest";
import { getWorkingHoursForDay } from "./workingHours";

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
});
