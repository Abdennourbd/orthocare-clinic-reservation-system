import { getClinicDayBoundsUTC, CLINIC_UTC_OFFSET_MINUTES } from "../time/clinicTime";
import {
  getWorkingHoursForDay,
  WorkingHoursSetting,
  parseHHmmToMinutes,
} from "./workingHours";

export type ScheduleExceptionInput = {
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  serviceId?: string | null;
};

export type AppointmentInput = {
  startTime: Date;
  endTime: Date;
  resourceId?: string | null;
};

export type SlotEngineInput = {
  localDateString: string; // YYYY-MM-DD
  serviceId?: string;
  serviceDurationMinutes: number;
  workingHours: WorkingHoursSetting;
  slotConfig: {
    granularityMinutes: number;
    bufferMinutes: number;
    lunchBreak: { start: string; end: string } | null;
  };
  bookingPolicy: {
    /** Rolling horizon in days. Calendar-day semantics: not currently used. */
    maxHorizonDays: number;
    minLeadTimeMinutes: number;
    clinicTimezone: string;
    pendingExpiryHours: number;
  };
  exceptions: ScheduleExceptionInput[];
  appointments: AppointmentInput[];
  nowUTC: Date;
  resourceId?: string | null;
};

export type AvailabilityInput = {
  appointments: AppointmentInput[];
  exceptions: ScheduleExceptionInput[];
  slotConfig: { bufferMinutes: number };
  serviceId?: string;
  resourceId?: string | null;
};

/** Two half-open intervals overlap iff each one's start is before the other's end. */
function overlaps(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

function overlapsAppointment(
  startMs: number,
  endMs: number,
  appt: AppointmentInput,
  bufferMinutes: number,
  requestedResourceId?: string | null,
): boolean {
  // Multi-chair seam: if the appointment is pinned to a different chair,
  // it does not block this slot. A null appointment resourceId is treated
  // as belonging to the single chair (safe default for v1).
  if (
    requestedResourceId &&
    appt.resourceId &&
    requestedResourceId !== appt.resourceId
  ) {
    return false;
  }

  const bufferMs = bufferMinutes * 60_000;
  return overlaps(
    startMs,
    endMs,
    appt.startTime.getTime() - bufferMs,
    appt.endTime.getTime() + bufferMs,
  );
}

function exceptionAppliesToService(
  exc: ScheduleExceptionInput,
  serviceId?: string,
): boolean {
  if (exc.serviceId && exc.serviceId !== serviceId) return false;
  return true;
}

function exceptionOverlapsSlot(
  startMs: number,
  endMs: number,
  exc: ScheduleExceptionInput,
): boolean {
  // Exception's UTC date range must overlap the slot.
  if (!overlaps(startMs, endMs, exc.startDate.getTime(), exc.endDate.getTime())) {
    return false;
  }

  if (exc.allDay) return true;

  // Partial-day: check the local-time window.
  if (exc.startTime && exc.endTime) {
    const excStartMin = parseHHmmToMinutes(exc.startTime);
    const excEndMin = parseHHmmToMinutes(exc.endTime);
    if (Number.isNaN(excStartMin) || Number.isNaN(excEndMin)) return false;

    // Convert slot's UTC ms to clinic-local minutes-since-midnight.
    const localStartMin =
      ((startMs + CLINIC_UTC_OFFSET_MINUTES * 60_000) / 60_000) % (24 * 60);
    const slotLocalEndMin = localStartMin + (endMs - startMs) / 60_000;

    return localStartMin < excEndMin && slotLocalEndMin > excStartMin;
  }

  return false;
}

/**
 * Re-checks whether a specific candidate slot is still available.
 * Used by Task 5 (`bookSlot`) to re-validate inside the transaction —
 * the engine must be able to answer this question for a single window
 * without re-generating the whole day.
 */
export function isSlotAvailable(
  startUTC: Date,
  endUTC: Date,
  opts: AvailabilityInput,
): boolean {
  const startMs = startUTC.getTime();
  const endMs = endUTC.getTime();

  for (const appt of opts.appointments) {
    if (
      overlapsAppointment(
        startMs,
        endMs,
        appt,
        opts.slotConfig.bufferMinutes,
        opts.resourceId,
      )
    ) {
      return false;
    }
  }

  for (const exc of opts.exceptions) {
    if (!exceptionAppliesToService(exc, opts.serviceId)) continue;
    if (exceptionOverlapsSlot(startMs, endMs, exc)) return false;
  }

  return true;
}

export function generateSlots(input: SlotEngineInput): Date[] {
  const {
    localDateString,
    workingHours,
    serviceDurationMinutes,
    slotConfig,
    bookingPolicy,
    nowUTC,
    appointments,
    exceptions,
  } = input;

  const wh = getWorkingHoursForDay(localDateString, workingHours);
  if (!wh) return [];

  const { startUTC } = getClinicDayBoundsUTC(localDateString);

  const slots: Date[] = [];
  const { openMinutes, closeMinutes } = wh;
  const { granularityMinutes, lunchBreak } = slotConfig;
  const { minLeadTimeMinutes, maxHorizonDays } = bookingPolicy;

  let lunchStartMin = -1;
  let lunchEndMin = -1;
  if (lunchBreak) {
    lunchStartMin = parseHHmmToMinutes(lunchBreak.start);
    lunchEndMin = parseHHmmToMinutes(lunchBreak.end);
  }

  // Horizon semantics: rolling 24h * maxHorizonDays window from nowUTC.
  // Note: calendar-day horizon (e.g. "up to and including day X") is
  // intentionally NOT used here; if that becomes a product requirement,
  // switch to comparing the slot's clinic-local date against
  // toClinicLocalDateString(nowUTC) + maxHorizonDays.
  const horizonMs = maxHorizonDays * 24 * 60 * 60 * 1000;
  const endOfHorizon = new Date(nowUTC.getTime() + horizonMs);
  const minAllowedMs = nowUTC.getTime() + minLeadTimeMinutes * 60_000;

  const availabilityOpts: AvailabilityInput = {
    appointments,
    exceptions,
    slotConfig: { bufferMinutes: slotConfig.bufferMinutes },
    serviceId: input.serviceId,
    resourceId: input.resourceId,
  };

  for (
    let min = openMinutes;
    min + serviceDurationMinutes <= closeMinutes;
    min += granularityMinutes
  ) {
    const slotTime = new Date(startUTC.getTime() + min * 60_000);
    const slotEndTime = new Date(
      slotTime.getTime() + serviceDurationMinutes * 60_000,
    );

    // Policy: lead time (and implicitly "past dates always rejected")
    if (slotTime.getTime() < minAllowedMs) continue;

    // Policy: horizon
    if (slotTime.getTime() > endOfHorizon.getTime()) continue;

    // Lunch break: a slot overlaps lunch if its start < lunchEnd AND its end > lunchStart.
    const slotEndMin = min + serviceDurationMinutes;
    if (lunchBreak && min < lunchEndMin && slotEndMin > lunchStartMin) continue;

    if (!isSlotAvailable(slotTime, slotEndTime, availabilityOpts)) continue;

    slots.push(slotTime);
  }

  return slots;
}
