import { describe, it, expect } from "vitest";
import { generateSlots, SlotEngineInput } from "./engine";

describe("generateSlots", () => {
  const baseInput: SlotEngineInput = {
    localDateString: "2026-08-25", // Tuesday
    serviceDurationMinutes: 30,
    workingHours: {
      tue: { open: "10:00", close: "17:00" },
    },
    slotConfig: {
      granularityMinutes: 15,
      bufferMinutes: 5,
      lunchBreak: null,
    },
    bookingPolicy: {
      minLeadTimeMinutes: 120,
      maxHorizonDays: 90,
      clinicTimezone: "Africa/Algiers",
      pendingExpiryHours: 24,
    },
    exceptions: [],
    appointments: [],
    nowUTC: new Date("2026-08-01T12:00:00Z"), // well in advance
  };

  it("returns candidate start times inside working hours", () => {
    const slots = generateSlots(baseInput);

    // 10:00 local is 09:00 UTC (Africa/Algiers is UTC+1)
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].toISOString()).toBe("2026-08-25T09:00:00.000Z");

    // Last slot should end at or before 17:00 local (16:00 UTC)
    // with 30 min duration, last start is 16:30 local (15:30 UTC)
    expect(slots[slots.length - 1].toISOString()).toBe(
      "2026-08-25T15:30:00.000Z"
    );

    // Every slot should be 15 min apart
    const diff = slots[1].getTime() - slots[0].getTime();
    expect(diff).toBe(15 * 60 * 1000);
  });

  it("handles lunch break", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      slotConfig: {
        ...baseInput.slotConfig,
        lunchBreak: { start: "13:00", end: "14:00" },
      },
    };

    const slots = generateSlots(input);

    // 13:00 local is 12:00 UTC
    // 14:00 local is 13:00 UTC
    const inLunch = slots.filter((slot) => {
      const ms = slot.getTime();
      const endMs = ms + 30 * 60000;
      const lunchStartMs =
        new Date("2026-08-25T12:00:00.000Z").getTime();
      const lunchEndMs = new Date("2026-08-25T13:00:00.000Z").getTime();

      // Overlap with lunch: slot start < lunchEnd AND slot end > lunchStart
      return ms < lunchEndMs && endMs > lunchStartMs;
    });

    expect(inLunch.length).toBe(0);

    // Should still have slots before and after lunch
    expect(slots.some(s => s.toISOString() === "2026-08-25T11:30:00.000Z")).toBe(true); // 12:30 local
    expect(slots.some(s => s.toISOString() === "2026-08-25T13:00:00.000Z")).toBe(true); // 14:00 local
  });

  it("rejects slots in the past, within lead time, or beyond horizon", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      localDateString: "2026-08-25",
      bookingPolicy: {
        ...baseInput.bookingPolicy,
        minLeadTimeMinutes: 120, // 2 hours
        maxHorizonDays: 1, // very short horizon
      },
    };

    // 1) Past & within lead time
    // If nowUTC is 2026-08-25T08:30:00Z (09:30 local)
    // lead time = 120 min => first allowed slot is 11:30 local (10:30 UTC)
    input.nowUTC = new Date("2026-08-25T08:30:00Z");
    const slots1 = generateSlots(input);
    expect(slots1[0].toISOString()).toBe("2026-08-25T10:30:00.000Z");

    // 2) Beyond horizon
    // Horizon is 1 day. So slots on 2026-08-25 are allowed if today is 24th or 25th.
    // If today is 23rd (nowUTC = 2026-08-23T12:00:00Z), horizon ends 24th.
    // So 25th should be empty.
    input.nowUTC = new Date("2026-08-23T12:00:00Z");
    const slots2 = generateSlots(input);
    expect(slots2.length).toBe(0);
  });

  it("excludes slots that overlap with active appointments (including buffer)", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      // Appointment from 11:00 to 11:30 local (10:00 to 10:30 UTC)
      appointments: [
        {
          startTime: new Date("2026-08-25T10:00:00Z"),
          endTime: new Date("2026-08-25T10:30:00Z"),
        },
      ],
    };

    const slots = generateSlots(input);

    // Buffer is 5 mins.
    // Blocked local range is 11:00 - 5m to 11:30 + 5m => 10:55 to 11:35
    // Candidates that overlap this:
    // - 10:30 slot ends at 11:00 (overlaps 10:55 - 11:35) -> EXCLUDED
    // - 10:45 slot ends at 11:15 -> EXCLUDED
    // - 11:00 slot -> EXCLUDED
    // - 11:15 slot -> EXCLUDED
    // - 11:30 slot ends at 12:00. Overlaps 10:55-11:35? Yes, 11:30 < 11:35 -> EXCLUDED.
    // - 11:45 slot starts at 11:45. > 11:35 -> NOT EXCLUDED.

    const localTimes = slots.map((s) => {
      // Return HH:mm local for easy assertion
      const hours = s.getUTCHours() + 1; // Africa/Algiers is UTC+1
      const mins = s.getUTCMinutes();
      return `${hours.toString().padStart(2, "0")}:${mins
        .toString()
        .padStart(2, "0")}`;
    });

    expect(localTimes).toContain("10:15");
    expect(localTimes).not.toContain("10:30");
    expect(localTimes).not.toContain("10:45");
    expect(localTimes).not.toContain("11:00");
    expect(localTimes).not.toContain("11:15");
    expect(localTimes).not.toContain("11:30");
    expect(localTimes).toContain("11:45");
  });

  it("excludes slots that overlap with full-day closures", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      exceptions: [
        {
          startDate: new Date("2026-08-25T00:00:00Z"),
          endDate: new Date("2026-08-25T23:59:59Z"),
          allDay: true,
        },
      ],
    };

    const slots = generateSlots(input);
    expect(slots.length).toBe(0);
  });

  it("excludes slots that overlap with partial-day closures", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      exceptions: [
        {
          startDate: new Date("2026-08-25T00:00:00Z"),
          endDate: new Date("2026-08-25T23:59:59Z"),
          allDay: false,
          startTime: "10:30", // local
          endTime: "11:30", // local
        },
      ],
    };

    const slots = generateSlots(input);
    
    const localTimes = slots.map((s) => {
      const hours = s.getUTCHours() + 1;
      const mins = s.getUTCMinutes();
      return `${hours.toString().padStart(2, "0")}:${mins
        .toString()
        .padStart(2, "0")}`;
    });

    // 10:30 local start: overlaps 10:30-11:30 -> excluded
    // 10:45 local start: overlaps 10:30-11:30 -> excluded
    // 11:00 local start: overlaps 10:30-11:30 -> excluded
    // 11:15 local start: overlaps 10:30-11:30 -> excluded
    // 11:30 local start: ends 12:00, starts at 11:30. Exception ends 11:30 -> NOT excluded

    expect(localTimes).toContain("10:00"); // 10:00 - 10:30 (ends exactly when exception starts -> NOT excluded)
    // expect(localTimes).toContain("10:15"); // 10:15 - 10:45 (overlaps exception -> EXCLUDED!)
    expect(localTimes).not.toContain("10:15");
    expect(localTimes).not.toContain("10:30");
    expect(localTimes).not.toContain("10:45");
    expect(localTimes).not.toContain("11:00");
    expect(localTimes).not.toContain("11:15");
    expect(localTimes).toContain("11:30");
  });
});
