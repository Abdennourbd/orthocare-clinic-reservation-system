import { CLINIC_UTC_OFFSET_MINUTES } from "../time/clinicTime";
import { parseHHmmToMinutes } from "../slots/workingHours";

// Task 21 — shared closure-window matching. Mirrors the slot engine's
// `exceptionOverlapsSlot` (src/lib/slots/engine.ts): an appointment is
// affected by a closure iff the UTC ranges overlap AND (allDay OR the
// appointment's clinic-local time-of-day overlaps the closure's HH:MM
// window). The window repeats each day of a multi-day range — same as the
// engine, so the "affected" preview and the engine's booking block can never
// disagree (a partial 13:00–14:00 closure must not list the whole day).

export type ClosureWindow = {
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
};

export type AppointmentWindow = {
  startTime: Date;
  endTime: Date;
};

export function appointmentOverlapsClosure(
  appt: AppointmentWindow,
  closure: ClosureWindow,
): boolean {
  const startMs = appt.startTime.getTime();
  const endMs = appt.endTime.getTime();
  if (!(startMs < closure.endDate.getTime() && closure.startDate.getTime() < endMs)) {
    return false;
  }

  if (closure.allDay) return true;

  if (closure.startTime && closure.endTime) {
    const excStartMin = parseHHmmToMinutes(closure.startTime);
    const excEndMin = parseHHmmToMinutes(closure.endTime);
    if (Number.isNaN(excStartMin) || Number.isNaN(excEndMin)) return false;

    const localStartMin =
      ((startMs + CLINIC_UTC_OFFSET_MINUTES * 60_000) / 60_000) % (24 * 60);
    const localEndMin = localStartMin + (endMs - startMs) / 60_000;

    return localStartMin < excEndMin && localEndMin > excStartMin;
  }

  return false;
}
