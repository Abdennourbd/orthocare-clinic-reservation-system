import { getClinicDayBoundsUTC, CLINIC_UTC_OFFSET_MINUTES } from "../time/clinicTime";
import {
  getWorkingHoursForDay,
  WorkingHoursSetting,
  parseHHmmToMinutes,
} from "./workingHours";

/**
 * Thrown when the slot engine receives a config value that would make it
 * loop forever, produce zero/negative-length slots, or silently disable
 * the inter-appointment buffer. These values come from admin-editable
 * Settings/Service rows, so a typo (or a compromised admin account) must
 * fail loudly rather than hang or corrupt availability.
 */
export class SlotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotConfigError";
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SlotConfigError(`${name} must be a positive integer, got ${value}`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new SlotConfigError(`${name} must be a non-negative integer, got ${value}`);
  }
}

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

/**
 * Everything the engine needs to decide whether a single [start, end] window
 * is bookable — i.e. the booking *policy* (working hours, lunch break, lead
 * time, horizon, past) combined with raw *availability* (appointment overlap
 * + ScheduleException closures). This is `SlotEngineInput` minus
 * `granularityMinutes`, which only matters when generating the whole day.
 *
 * Both `generateSlots` and `bookSlot` (Task 5) delegate here so the offered
 * slot list and the transaction re-check can never disagree.
 */
export type SlotBookabilityInput = {
  localDateString: string;
  serviceId?: string;
  serviceDurationMinutes: number;
  workingHours: WorkingHoursSetting;
  slotConfig: {
    bufferMinutes: number;
    lunchBreak: { start: string; end: string } | null;
  };
  bookingPolicy: {
    /** Rolling horizon in days. */
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

  assertNonNegativeInteger("bufferMinutes", opts.slotConfig.bufferMinutes);

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

/**
 * Single source of truth for "is this [start, end] window bookable?".
 * Combines the booking policy (working-hours window, lunch break, lead time,
 * horizon, past-date) with raw availability (appointment overlap +
 * closures). Used by `generateSlots` and by Task 5's `bookSlot` re-check
 * inside the transaction.
 */
export function isSlotBookable(
  startUTC: Date,
  endUTC: Date,
  input: SlotBookabilityInput,
): boolean {
  const {
    localDateString,
    serviceDurationMinutes,
    workingHours,
    slotConfig,
    bookingPolicy,
    nowUTC,
  } = input;

  assertPositiveInteger("serviceDurationMinutes", serviceDurationMinutes);
  assertNonNegativeInteger("bufferMinutes", slotConfig.bufferMinutes);

  const startMs = startUTC.getTime();
  const endMs = endUTC.getTime();

  // Working-hours window. A slot must start at/after open and END at/before
  // close (matches the loop bound in generateSlots).
  const wh = getWorkingHoursForDay(localDateString, workingHours);
  if (!wh) return false;
  const { startUTC: dayStartUTC } = getClinicDayBoundsUTC(localDateString);
  const openMs = dayStartUTC.getTime() + wh.openMinutes * 60_000;
  const closeMs = dayStartUTC.getTime() + wh.closeMinutes * 60_000;
  if (startMs < openMs || endMs > closeMs) return false;

  // Horizon + lead time (also rejects any slot in the past).
  const horizonMs = bookingPolicy.maxHorizonDays * 24 * 60 * 60 * 1000;
  const endOfHorizonMs = nowUTC.getTime() + horizonMs;
  const minAllowedMs = nowUTC.getTime() + bookingPolicy.minLeadTimeMinutes * 60_000;
  if (startMs < minAllowedMs) return false;
  if (startMs > endOfHorizonMs) return false;

  // Lunch break: a slot overlaps lunch if its start < lunchEnd AND its end > lunchStart.
  let lunchStartMin = -1;
  let lunchEndMin = -1;
  if (slotConfig.lunchBreak) {
    lunchStartMin = parseHHmmToMinutes(slotConfig.lunchBreak.start);
    lunchEndMin = parseHHmmToMinutes(slotConfig.lunchBreak.end);
  }
  const slotStartMin = (startMs - dayStartUTC.getTime()) / 60_000;
  const slotEndMin = slotStartMin + serviceDurationMinutes;
  if (slotConfig.lunchBreak && slotStartMin < lunchEndMin && slotEndMin > lunchStartMin) {
    return false;
  }

  // Raw availability: appointment overlap (with buffer) + closures.
  return isSlotAvailable(startUTC, endUTC, {
    appointments: input.appointments,
    exceptions: input.exceptions,
    slotConfig: { bufferMinutes: slotConfig.bufferMinutes },
    serviceId: input.serviceId,
    resourceId: input.resourceId,
  });
}

export function generateSlots(input: SlotEngineInput): Date[] {
  const {
    localDateString,
    workingHours,
    serviceDurationMinutes,
    slotConfig,
    bookingPolicy,
    nowUTC,
  } = input;

  // Validate the numeric inputs that drive the generation loop before
  // entering it. A zero/negative step or duration would otherwise loop
  // forever (remote DoS once this is wired to a route).
  assertPositiveInteger("serviceDurationMinutes", serviceDurationMinutes);
  assertPositiveInteger("granularityMinutes", slotConfig.granularityMinutes);
  assertNonNegativeInteger("bufferMinutes", slotConfig.bufferMinutes);

  const wh = getWorkingHoursForDay(localDateString, workingHours);
  if (!wh) return [];

  const { startUTC } = getClinicDayBoundsUTC(localDateString);

  const slots: Date[] = [];
  const { openMinutes, closeMinutes } = wh;
  const { granularityMinutes } = slotConfig;

  // Horizon semantics: rolling 24h * maxHorizonDays window from nowUTC.
  // Note: calendar-day horizon (e.g. "up to and including day X") is
  // intentionally NOT used here; if that becomes a product requirement,
  // switch to comparing the slot's clinic-local date against
  // toClinicLocalDateString(nowUTC) + maxHorizonDays.
  const bookabilityInput: SlotBookabilityInput = {
    localDateString,
    serviceId: input.serviceId,
    serviceDurationMinutes,
    workingHours,
    slotConfig,
    bookingPolicy,
    exceptions: input.exceptions,
    appointments: input.appointments,
    nowUTC,
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

    // Delegates policy + availability (lead time, horizon, past, lunch,
    // overlap, closures) to the single source of truth shared with bookSlot.
    if (!isSlotBookable(slotTime, slotEndTime, bookabilityInput)) continue;

    slots.push(slotTime);
  }

  return slots;
}
