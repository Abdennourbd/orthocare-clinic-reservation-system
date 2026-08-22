import { describe, it, expect } from "vitest";
import { getDaySlotOverview, SlotEngineInput } from "./engine";

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

function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

describe("getDaySlotOverview", () => {
  it("marks all candidate slots available when nothing is booked", () => {
    const { available, occupied } = getDaySlotOverview(baseInput);

    // 10:00 -> 16:30 local by 15-min granularity, 30-min duration.
    expect(available.length).toBeGreaterThan(0);
    expect(available[0].toISOString()).toBe("2026-08-25T09:00:00.000Z");
    expect(occupied).toHaveLength(0);
  });

  it("moves a slot into occupied when an active appointment overlaps it", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      appointments: [
        {
          startTime: localStart("2026-08-25", "11:00"),
          endTime: localStart("2026-08-25", "11:30"),
          resourceId: null,
        },
      ],
    };

    const { available, occupied } = getDaySlotOverview(input);

    // The 11:00 slot is taken; with a 5-min buffer 11:15 and 11:30 are also
    // blocked (occupied window 10:55-11:35 vs slots 11:15-11:45, 11:30-12:00).
    const occupiedTimes = occupied.map((d) => formatHHmmLocal(d));
    expect(occupiedTimes).toContain("11:00");
    expect(occupiedTimes).toContain("11:15");
    expect(occupiedTimes).toContain("11:30");
    // The first slot entirely after the blocked window is available.
    const availableTimes = available.map((d) => formatHHmmLocal(d));
    expect(availableTimes).toContain("10:00");
    expect(availableTimes).toContain("11:45");
  });

  it("excludes policy-blocked slots (past/lead time) from both lists", () => {
    // A huge lead time makes every candidate non-bookable, but they are NOT
    // occupied either — they must simply not appear.
    const input: SlotEngineInput = {
      ...baseInput,
      bookingPolicy: { ...baseInput.bookingPolicy, minLeadTimeMinutes: 525600 },
    };

    const { available, occupied } = getDaySlotOverview(input);
    expect(available).toHaveLength(0);
    expect(occupied).toHaveLength(0);
  });

  it("returns empty lists on a closed day", () => {
    const input: SlotEngineInput = {
      ...baseInput,
      localDateString: "2026-08-28", // Friday — not configured in workingHours
    };
    const { available, occupied } = getDaySlotOverview(input);
    expect(available).toHaveLength(0);
    expect(occupied).toHaveLength(0);
  });
});

function formatHHmmLocal(d: Date): string {
  return `${String(d.getUTCHours() + 1).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}`;
}