import {
  addClinicDays,
  getClinicDayBoundsUTC,
  getClinicDayOfWeek,
  toClinicLocalDateString,
} from "../time/clinicTime";
import { getWorkingHoursForDay } from "../slots/workingHours";

// Task 18 — pure KPI aggregations (no DB, no Next.js imports).
// All date maths goes through lib/time/clinicTime.ts: ranges are clinic-local
// YYYY-MM-DD, instants are UTC. Working-hours-only denominator (no closures).

export type KpiAppointmentInput = {
  status:
    | "PENDING"
    | "CONFIRMED"
    | "COMPLETED"
    | "NO_SHOW"
    | "CANCELLED"
    | "RESCHEDULED";
  source: "ONLINE" | "MANUAL";
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelReason: "STAFF" | "PATIENT_SELF_SERVICE" | "AUTO_EXPIRED" | "CLOSURE" | null;
};

export type KpiPatientInput = {
  createdAt: Date;
};

export type KpiResult = {
  from: string;
  to: string;
  total: number;
  pendingCount: number;
  todayCount: number;
  newPatients: number;
  bookedMinutes: number;
  openMinutes: number;
  utilizationRate: number | null;
  noShowRate: number | null;
  onlineShare: number | null;
  autoExpiryRate: number | null;
  medianConfirmMinutes: number | null;
};

/**
 * Current clinic week Sat→Thu containing `todayLocal` (YYYY-MM-DD).
 * Fri is closed: on a Friday the completed Sat→Thu week just ended is
 * returned, so the dashboard never shows an empty "week" of one closed day.
 */
export function getClinicWeekRange(todayLocal: string): {
  from: string;
  to: string;
} {
  const dow = getClinicDayOfWeek(todayLocal);
  // Offset back to Saturday: sat 0, sun 1, mon 2, tue 3, wed 4, thu 5, fri 6.
  const backToSat: Record<string, number> = {
    sat: 0,
    sun: 1,
    mon: 2,
    tue: 3,
    wed: 4,
    thu: 5,
    fri: 6,
  };
  const back = backToSat[dow] ?? 0;
  if (dow === "fri") {
    // Previous completed week: Sat 6 days ago → Thu yesterday.
    return {
      from: addClinicDays(todayLocal, -6),
      to: addClinicDays(todayLocal, -1),
    };
  }
  return { from: addClinicDays(todayLocal, -back), to: todayLocal };
}

/** Open minutes in [from, to] (inclusive, clinic-local dates). Fri = 0. */
export function computeOpenMinutes(
  workingHours: unknown,
  from: string,
  to: string,
): number {
  let total = 0;
  let cursor = from;
  // Guard against inverted ranges — 400 is the route's job; the lib stays total.
  for (let i = 0; i < 370 && cursor <= to; i++) {
    const day = getWorkingHoursForDay(cursor, workingHours);
    if (day) total += day.closeMinutes - day.openMinutes;
    if (cursor === to) break;
    cursor = addClinicDays(cursor, 1);
  }
  return total;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeKpis(input: {
  appointments: KpiAppointmentInput[];
  patients: KpiPatientInput[];
  workingHours: unknown;
  from: string;
  to: string;
  today: string;
}): KpiResult {
  const { appointments, patients, workingHours, from, to, today } = input;
  const { startUTC: fromStart } = getClinicDayBoundsUTC(from);
  const { endUTC: toEnd } = getClinicDayBoundsUTC(to);

  const inRange = appointments.filter(
    (a) => a.startTime >= fromStart && a.startTime <= toEnd,
  );

  const pendingCount = inRange.filter((a) => a.status === "PENDING").length;
  const todayCount = inRange.filter(
    (a) =>
      a.status !== "CANCELLED" &&
      toClinicLocalDateString(a.startTime) === today,
  ).length;

  const newPatients = patients.filter(
    (p) => p.createdAt >= fromStart && p.createdAt <= toEnd,
  ).length;

  const bookedMinutes = inRange
    .filter((a) => a.status !== "CANCELLED" && a.status !== "RESCHEDULED")
    .reduce((sum, a) => sum + (a.endTime.getTime() - a.startTime.getTime()) / 60000, 0);

  const openMinutes = computeOpenMinutes(workingHours, from, to);
  const utilizationRate = openMinutes > 0 ? bookedMinutes / openMinutes : null;

  const completed = inRange.filter((a) => a.status === "COMPLETED").length;
  const noShow = inRange.filter((a) => a.status === "NO_SHOW").length;
  const noShowRate =
    completed + noShow > 0 ? noShow / (completed + noShow) : null;

  const online = inRange.filter((a) => a.source === "ONLINE").length;
  const onlineShare = inRange.length > 0 ? online / inRange.length : null;

  const autoExpired = inRange.filter(
    (a) => a.status === "CANCELLED" && a.cancelReason === "AUTO_EXPIRED",
  ).length;
  const autoExpiryRate = online > 0 ? autoExpired / online : null;

  const confirmDiffsMinutes = inRange
    .filter((a) => a.confirmedAt !== null)
    .map(
      (a) =>
        ((a.confirmedAt as Date).getTime() - a.createdAt.getTime()) / 60000,
    )
    .filter((v) => Number.isFinite(v) && v >= 0);
  const medianConfirmMinutes = median(confirmDiffsMinutes);

  return {
    from,
    to,
    total: inRange.length,
    pendingCount,
    todayCount,
    newPatients,
    bookedMinutes: Math.round(bookedMinutes),
    openMinutes,
    utilizationRate,
    noShowRate,
    onlineShare,
    autoExpiryRate,
    medianConfirmMinutes,
  };
}
