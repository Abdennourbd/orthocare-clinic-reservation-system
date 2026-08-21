import { describe, it, expect } from "vitest";
import { isSlotBookable, SlotBookabilityInput } from "./engine";

// `isSlotBookable` is the single source of truth for whether a [start, end]
// window is bookable: it combines the booking *policy* (working hours, lunch
// break, lead time, horizon, past) with raw *availability* (appointment
// overlap + ScheduleException closures). `generateSlots` and `bookSlot` both
// delegate to it so the offered list and the booked slot can never disagree.

const baseInput: SlotBookabilityInput = {
  localDateString: "2026-08-25", // Tuesday
  serviceDurationMinutes: 30,
  workingHours: {
    tue: { open: "10:00", close: "17:00" },
  },
  slotConfig: {
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

describe("isSlotBookable", () => {
  it("returns true for a slot inside working hours with no conflict", () => {
    // 11:00 local = 10:00 UTC (Africa/Algiers is UTC+1)
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        baseInput,
      ),
    ).toBe(true);
  });

  it("returns false for a slot outside working hours (before open)", () => {
    // 09:30 local = 08:30 UTC, before the 10:00 local open
    expect(
      isSlotBookable(
        new Date("2026-08-25T08:30:00Z"),
        new Date("2026-08-25T09:00:00Z"),
        baseInput,
      ),
    ).toBe(false);
  });

  it("returns false for a slot that overlaps the lunch break", () => {
    // 13:30 local = 12:30 UTC (Africa/Algiers is UTC+1); lunch is 13:00-14:00 local.
    expect(
      isSlotBookable(
        new Date("2026-08-25T12:30:00Z"),
        new Date("2026-08-25T13:00:00Z"),
        {
          ...baseInput,
          slotConfig: { ...baseInput.slotConfig, lunchBreak: { start: "13:00", end: "14:00" } },
        },
      ),
    ).toBe(false);
  });

  it("returns false within the minimum lead time", () => {
    // nowUTC is 11:30 local (10:30 UTC); lead time 120 min means first
    // allowed slot starts at 13:30 local. 11:00 local (10:00 UTC) is too soon.
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        { ...baseInput, nowUTC: new Date("2026-08-25T10:30:00Z") },
      ),
    ).toBe(false);
  });

  it("returns false for a slot in the past", () => {
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        { ...baseInput, nowUTC: new Date("2026-08-25T11:00:00Z") },
      ),
    ).toBe(false);
  });

  it("returns false beyond the booking horizon", () => {
    // nowUTC = 2026-08-23, horizon 1 day ends 2026-08-24; 25th is out.
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        {
          ...baseInput,
          bookingPolicy: { ...baseInput.bookingPolicy, maxHorizonDays: 1 },
          nowUTC: new Date("2026-08-23T12:00:00Z"),
        },
      ),
    ).toBe(false);
  });

  it("returns false when an appointment overlaps (with buffer)", () => {
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        {
          ...baseInput,
          appointments: [
            { startTime: new Date("2026-08-25T10:10:00Z"), endTime: new Date("2026-08-25T10:25:00Z") },
          ],
        },
      ),
    ).toBe(false);
  });

  it("returns false when a closure exception overlaps the slot", () => {
    expect(
      isSlotBookable(
        new Date("2026-08-25T10:00:00Z"),
        new Date("2026-08-25T10:30:00Z"),
        {
          ...baseInput,
          exceptions: [
            { startDate: new Date("2026-08-24T23:00:00.000Z"), endDate: new Date("2026-08-25T22:59:59.999Z"), allDay: true },
          ],
        },
      ),
    ).toBe(false);
  });
});
