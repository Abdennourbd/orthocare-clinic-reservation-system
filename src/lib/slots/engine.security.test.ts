import { describe, it, expect } from "vitest";
import { generateSlots, isSlotAvailable, SlotEngineInput } from "./engine";

/**
 * Security/adversarial tests for the slot engine.
 *
 * The engine is pure logic, so its attack surface is the VALUES it trusts:
 *   - slotConfig.granularityMinutes / bufferMinutes  (admin-editable Setting, Task 21)
 *   - serviceDurationMinutes                          (admin-editable Service, Task 21)
 *   - localDateString                                 (the ?date= query param, Task 6)
 * A malformed or hostile value must fail loudly (typed error) or safely
 * (empty), never hang the request or corrupt availability.
 */

function baseInput(): SlotEngineInput {
  return {
    localDateString: "2026-08-25", // Tuesday
    serviceDurationMinutes: 30,
    workingHours: { tue: { open: "10:00", close: "17:00" } },
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
    nowUTC: new Date("2026-08-01T12:00:00Z"),
  };
}

describe("slot engine — adversarial config", () => {
  // These are the DoS landmines: a zero/negative step makes the generation
  // loop never terminate. Before validation these HANG; after, they throw.
  // Each is given a short timeout so a regression surfaces as a test failure
  // instead of freezing the whole suite.

  it("rejects zero granularity (would infinite-loop)", { timeout: 1500 }, () => {
    expect(() =>
      generateSlots({ ...baseInput(), slotConfig: { ...baseInput().slotConfig, granularityMinutes: 0 } }),
    ).toThrow();
  });

  it("rejects negative granularity (would infinite-loop)", { timeout: 1500 }, () => {
    expect(() =>
      generateSlots({ ...baseInput(), slotConfig: { ...baseInput().slotConfig, granularityMinutes: -15 } }),
    ).toThrow();
  });

  it("rejects zero service duration", { timeout: 1500 }, () => {
    expect(() => generateSlots({ ...baseInput(), serviceDurationMinutes: 0 })).toThrow();
  });

  it("rejects negative service duration (would infinite-loop)", { timeout: 1500 }, () => {
    expect(() => generateSlots({ ...baseInput(), serviceDurationMinutes: -30 })).toThrow();
  });

  it("rejects negative buffer minutes (silently disabled/inverted buffer -> double-booking)", () => {
    expect(() =>
      generateSlots({ ...baseInput(), slotConfig: { ...baseInput().slotConfig, bufferMinutes: -5 } }),
    ).toThrow();
  });

  it("isSlotAvailable rejects negative buffer minutes", () => {
    expect(() =>
      isSlotAvailable(new Date("2026-08-25T10:00:00Z"), new Date("2026-08-25T10:30:00Z"), {
        appointments: [],
        exceptions: [],
        slotConfig: { bufferMinutes: -5 },
      }),
    ).toThrow();
  });

  it("does not throw or hang on a malformed date string", { timeout: 1500 }, () => {
    // A hostile ?date= value must not crash the endpoint. Empty result is safe.
    const slots = generateSlots({ ...baseInput(), localDateString: "not-a-date" });
    expect(Array.isArray(slots)).toBe(true);
  });

  it("does not throw or hang on a malformed lunch-break time", { timeout: 1500 }, () => {
    const slots = generateSlots({
      ...baseInput(),
      slotConfig: {
        ...baseInput().slotConfig,
        lunchBreak: { start: "garbage", end: "14:00" },
      },
    });
    expect(Array.isArray(slots)).toBe(true);
  });
});
