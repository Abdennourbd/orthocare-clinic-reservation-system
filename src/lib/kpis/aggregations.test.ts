import { describe, it, expect } from "vitest";
import {
  computeKpis,
  computeOpenMinutes,
  getClinicWeekRange,
} from "./aggregations";
import { clinicLocalToUTC } from "../time/clinicTime";

// Task 18 — TDD RED: pure KPI aggregations over a Sat→Thu clinic week.
// Week under test: Sat 2026-08-29 → Thu 2026-09-03 (today = Thu, per prompt).
// Working hours Sat–Thu 10:00–17:00 (420 min/day), Fri closed.

const WORKING_HOURS = {
  sat: { open: "10:00", close: "17:00" },
  sun: { open: "10:00", close: "17:00" },
  mon: { open: "10:00", close: "17:00" },
  tue: { open: "10:00", close: "17:00" },
  wed: { open: "10:00", close: "17:00" },
  thu: { open: "10:00", close: "17:00" },
  fri: { closed: true },
} as const;

function utc(date: string, time: string): Date {
  const d = clinicLocalToUTC(date, time);
  if (!d) throw new Error(`bad date ${date} ${time}`);
  return d;
}

describe("getClinicWeekRange (Sat→Thu)", () => {
  it("returns Sat→today when today is Thu", () => {
    expect(getClinicWeekRange("2026-09-03")).toEqual({
      from: "2026-08-29",
      to: "2026-09-03",
    });
  });

  it("returns Sat→today when today is Sat", () => {
    expect(getClinicWeekRange("2026-08-29")).toEqual({
      from: "2026-08-29",
      to: "2026-08-29",
    });
  });

  it("returns previous completed Sat→Thu when today is Fri (closed)", () => {
    expect(getClinicWeekRange("2026-09-04")).toEqual({
      from: "2026-08-29",
      to: "2026-09-03",
    });
  });

  it.each([
    ["2026-08-30", "2026-08-29"], // Sun → Sat
    ["2026-08-31", "2026-08-29"], // Mon → Sat
    ["2026-09-01", "2026-08-29"], // Tue → Sat
    ["2026-09-02", "2026-08-29"], // Wed → Sat
  ])("returns Sat→today when today is %s", (today, from) => {
    expect(getClinicWeekRange(today)).toEqual({ from, to: today });
  });
});

describe("computeOpenMinutes", () => {
  it("counts 420 min/day Sat–Thu and 0 on Fri", () => {
    // Full clinic week Sat 29 Aug → Thu 3 Sep = 6 open days × 420 = 2520.
    expect(computeOpenMinutes(WORKING_HOURS, "2026-08-29", "2026-09-03")).toBe(
      2520,
    );
    // Fri alone is closed.
    expect(computeOpenMinutes(WORKING_HOURS, "2026-09-04", "2026-09-04")).toBe(
      0,
    );
  });
});

describe("computeKpis", () => {
  it("aggregates the week into the plan.md success metrics", () => {
    const appointments = [
      {
        // A1 ONLINE CONFIRMED Sat 10:00–10:30, confirmed 2h after creation.
        status: "CONFIRMED",
        source: "ONLINE",
        startTime: utc("2026-08-29", "10:00"),
        endTime: utc("2026-08-29", "10:30"),
        createdAt: utc("2026-08-28", "10:00"),
        confirmedAt: utc("2026-08-28", "12:00"),
        cancelReason: null,
      },
      {
        // A2 MANUAL COMPLETED Sun 11:00–11:30, confirmed 1h after creation.
        status: "COMPLETED",
        source: "MANUAL",
        startTime: utc("2026-08-30", "11:00"),
        endTime: utc("2026-08-30", "11:30"),
        createdAt: utc("2026-08-29", "09:00"),
        confirmedAt: utc("2026-08-29", "10:00"),
        cancelReason: null,
      },
      {
        // A3 ONLINE NO_SHOW Mon.
        status: "NO_SHOW",
        source: "ONLINE",
        startTime: utc("2026-08-31", "10:00"),
        endTime: utc("2026-08-31", "10:30"),
        createdAt: utc("2026-08-30", "10:00"),
        confirmedAt: utc("2026-08-30", "11:00"),
        cancelReason: null,
      },
      {
        // A4 ONLINE CANCELLED AUTO_EXPIRED Tue — excluded from booked minutes.
        status: "CANCELLED",
        source: "ONLINE",
        startTime: utc("2026-09-01", "10:00"),
        endTime: utc("2026-09-01", "10:30"),
        createdAt: utc("2026-08-31", "10:00"),
        confirmedAt: null,
        cancelReason: "AUTO_EXPIRED",
      },
      {
        // A5 ONLINE PENDING Wed — blocks the slot, counts as booked.
        status: "PENDING",
        source: "ONLINE",
        startTime: utc("2026-09-02", "10:00"),
        endTime: utc("2026-09-02", "10:30"),
        createdAt: utc("2026-09-01", "10:00"),
        confirmedAt: null,
        cancelReason: null,
      },
      {
        // A6 ONLINE RESCHEDULED Thu — freed slot, excluded from booked.
        status: "RESCHEDULED",
        source: "ONLINE",
        startTime: utc("2026-09-03", "10:00"),
        endTime: utc("2026-09-03", "10:30"),
        createdAt: utc("2026-09-02", "10:00"),
        confirmedAt: utc("2026-09-02", "11:00"),
        cancelReason: null,
      },
    ] as const;

    const patients = [
      { createdAt: utc("2026-08-29", "12:00") },
      { createdAt: utc("2026-09-01", "12:00") },
      // Before the range — must not count.
      { createdAt: utc("2026-08-20", "12:00") },
    ];

    const kpis = computeKpis({
      // @ts-expect-error — readonly test fixtures widen to the lib input type
      appointments,
      patients,
      workingHours: WORKING_HOURS,
      from: "2026-08-29",
      to: "2026-09-03",
      today: "2026-09-03",
    });

    expect(kpis.total).toBe(6);
    expect(kpis.pendingCount).toBe(1);
    // Thu has only the RESCHEDULED row (stale — the reschedule holds the new
    // slot), so today counts 0: RESCHEDULED is excluded like CANCELLED.
    expect(kpis.todayCount).toBe(0);
    expect(kpis.newPatients).toBe(2);
    expect(kpis.bookedMinutes).toBe(120);
    expect(kpis.openMinutes).toBe(2520);
    expect(kpis.utilizationRate).toBeCloseTo(120 / 2520, 5);
    // NO_SHOW 1 / (COMPLETED 1 + NO_SHOW 1).
    expect(kpis.noShowRate).toBeCloseTo(0.5, 5);
    // ONLINE 5 / 6.
    expect(kpis.onlineShare).toBeCloseTo(5 / 6, 5);
    // AUTO_EXPIRED 1 / ONLINE 5.
    expect(kpis.autoExpiryRate).toBeCloseTo(0.2, 5);
    // Confirmed diffs: 120, 60, 60, 60 → median 60 min.
    expect(kpis.medianConfirmMinutes).toBe(60);
  });

  it("takes the median over an odd count and ignores negative diffs", () => {
    const mk = (
      createdAt: Date,
      confirmedAt: Date | null,
    ): {
      status: "CONFIRMED";
      source: "ONLINE";
      startTime: Date;
      endTime: Date;
      createdAt: Date;
      confirmedAt: Date | null;
      cancelReason: null;
    } => ({
      status: "CONFIRMED",
      source: "ONLINE",
      startTime: utc("2026-08-29", "10:00"),
      endTime: utc("2026-08-29", "10:30"),
      createdAt,
      confirmedAt,
      cancelReason: null,
    });
    const kpis = computeKpis({
      appointments: [
        mk(utc("2026-08-28", "10:00"), utc("2026-08-28", "10:30")), // +30
        mk(utc("2026-08-28", "10:00"), utc("2026-08-28", "11:00")), // +60
        mk(utc("2026-08-28", "10:00"), utc("2026-08-28", "12:00")), // +120
        // Clock-skew fixture: confirmed before created → discarded.
        mk(utc("2026-08-28", "12:00"), utc("2026-08-28", "10:00")),
      ],
      patients: [],
      workingHours: WORKING_HOURS,
      from: "2026-08-29",
      to: "2026-08-29",
      today: "2026-08-29",
    });
    expect(kpis.medianConfirmMinutes).toBe(60);
  });

  it("returns null rates (not NaN) on an empty range", () => {
    const kpis = computeKpis({
      appointments: [],
      patients: [],
      workingHours: WORKING_HOURS,
      from: "2026-08-29",
      to: "2026-08-29",
      today: "2026-08-29",
    });
    expect(kpis.total).toBe(0);
    expect(kpis.noShowRate).toBeNull();
    expect(kpis.onlineShare).toBeNull();
    expect(kpis.autoExpiryRate).toBeNull();
    expect(kpis.medianConfirmMinutes).toBeNull();
    // Sat is open (420 min) with nothing booked → 0% utilized, not null.
    // Null is reserved for zero open minutes (e.g. Fri alone).
    expect(kpis.utilizationRate).toBe(0);
  });
});
