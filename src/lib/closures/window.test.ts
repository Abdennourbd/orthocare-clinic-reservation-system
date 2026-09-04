import { describe, expect, it } from "vitest";
import { appointmentOverlapsClosure } from "./window";

const appt = (start: string, end: string) => ({
  startTime: new Date(start),
  endTime: new Date(end),
});

describe("appointmentOverlapsClosure", () => {
  it("matches an all-day closure overlapping the appointment (multi-day range)", () => {
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T10:00:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-01T00:00:00Z"),
          endDate: new Date("2026-09-03T00:00:00Z"),
          allDay: true,
        },
      ),
    ).toBe(true);
  });

  it("rejects an all-day closure outside the appointment", () => {
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-05T10:00:00Z", "2026-09-05T10:30:00Z"),
        {
          startDate: new Date("2026-09-01T00:00:00Z"),
          endDate: new Date("2026-09-02T00:00:00Z"),
          allDay: true,
        },
      ),
    ).toBe(false);
  });

  it("matches a partial window containing the appointment (clinic-local)", () => {
    // 10:00Z = 11:00 clinic-local; closure 10:30–12:00 local overlaps.
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T10:00:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-02T00:00:00Z"),
          endDate: new Date("2026-09-02T23:59:59Z"),
          allDay: false,
          startTime: "10:30",
          endTime: "12:00",
        },
      ),
    ).toBe(true);
  });

  it("rejects an adjacent partial window (no overlap)", () => {
    // Appointment 11:00–11:30 local; closure 12:00–13:00 local.
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T10:00:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-02T00:00:00Z"),
          endDate: new Date("2026-09-02T23:59:59Z"),
          allDay: false,
          startTime: "12:00",
          endTime: "13:00",
        },
      ),
    ).toBe(false);
  });

  it("matches a spanning appointment crossing the window start", () => {
    // Appointment 10:30–11:30 local; closure 11:00–12:00 local.
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T09:30:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-02T00:00:00Z"),
          endDate: new Date("2026-09-02T23:59:59Z"),
          allDay: false,
          startTime: "11:00",
          endTime: "12:00",
        },
      ),
    ).toBe(true);
  });

  it("returns false for malformed HH:MM windows", () => {
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T10:00:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-02T00:00:00Z"),
          endDate: new Date("2026-09-02T23:59:59Z"),
          allDay: false,
          startTime: "nope",
          endTime: "12:00",
        },
      ),
    ).toBe(false);
  });

  it("returns false for a partial closure with no window at all", () => {
    expect(
      appointmentOverlapsClosure(
        appt("2026-09-02T10:00:00Z", "2026-09-02T10:30:00Z"),
        {
          startDate: new Date("2026-09-02T00:00:00Z"),
          endDate: new Date("2026-09-02T23:59:59Z"),
          allDay: false,
        },
      ),
    ).toBe(false);
  });
});
