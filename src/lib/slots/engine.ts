import { getClinicDayBoundsUTC } from "../time/clinicTime";
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
    minLeadTimeMinutes: number;
    maxHorizonDays: number;
    clinicTimezone: string;
    pendingExpiryHours: number;
  };
  exceptions: ScheduleExceptionInput[];
  appointments: { startTime: Date; endTime: Date; resourceId?: string | null }[];
  nowUTC: Date;
  resourceId?: string | null;
};

export function generateSlots(input: SlotEngineInput): Date[] {
  const { localDateString, workingHours, serviceDurationMinutes, slotConfig, bookingPolicy, nowUTC, appointments, exceptions } =
    input;

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

  // Horizon in ms: maxHorizonDays * 24h
  const horizonMs = maxHorizonDays * 24 * 60 * 60 * 1000;
  const endOfHorizon = new Date(nowUTC.getTime() + horizonMs);

  for (
    let min = openMinutes;
    min + serviceDurationMinutes <= closeMinutes;
    min += granularityMinutes
  ) {
    const slotTime = new Date(startUTC.getTime() + min * 60000);
    const slotEndTime = new Date(slotTime.getTime() + serviceDurationMinutes * 60000);

    // Policy: Lead time
    if (slotTime.getTime() < nowUTC.getTime() + minLeadTimeMinutes * 60000) {
      continue;
    }

    // Policy: Horizon
    if (slotTime.getTime() > endOfHorizon.getTime()) {
      continue;
    }

    // Check lunch overlap:
    // A slot overlaps lunch if its start < lunchEnd AND its end > lunchStart.
    const slotEndMin = min + serviceDurationMinutes;
    const overlapsLunch =
      lunchBreak && min < lunchEndMin && slotEndMin > lunchStartMin;

    if (overlapsLunch) {
      continue;
    }

    // Check appointment overlap (with buffer)
    // For v1, single chair means we ignore resourceId and check all appointments.
    const hasOverlap = appointments.some((appt) => {
      // If resourceId is specified in request AND appointment, they must match.
      // But we default to treating everything as overlapping for single resource.
      if (input.resourceId && appt.resourceId && input.resourceId !== appt.resourceId) {
        return false;
      }
      
      const apptStartMs = appt.startTime.getTime();
      const apptEndMs = appt.endTime.getTime();
      const bufferMs = slotConfig.bufferMinutes * 60000;

      // Expand the appointment's blocked window by bufferMinutes on both sides
      const blockedStartMs = apptStartMs - bufferMs;
      const blockedEndMs = apptEndMs + bufferMs;

      // Overlap: slot start < blockedEnd AND slot end > blockedStart
      return slotTime.getTime() < blockedEndMs && slotEndTime.getTime() > blockedStartMs;
    });

    if (hasOverlap) {
      continue;
    }

    // Check exceptions (closures)
    // Exception applies if:
    // 1. serviceId matches or is null
    // 2. allDay is true AND slot date matches exception date
    // 3. allDay is false AND slot overlaps [exceptionStartLocal, exceptionEndLocal]
    const hasException = exceptions.some((exc) => {
      // Filter by serviceId
      if (exc.serviceId && exc.serviceId !== input.serviceId) {
        return false;
      }

      const excStartMs = exc.startDate.getTime();
      const excEndMs = exc.endDate.getTime();

      // Ensure the exception's date range covers the slot.
      // Exception dates are stored in UTC. 
      // For allDay, the DB stores the clinic-local day boundaries in UTC (e.g., 23:00 to 22:59).
      // For partial day, startDate/endDate still cover the day.
      const coversDate = slotTime.getTime() < excEndMs && slotEndTime.getTime() > excStartMs;

      if (!coversDate) {
        return false;
      }

      if (exc.allDay) {
        return true;
      } else {
        if (exc.startTime && exc.endTime) {
          const excStartMin = parseHHmmToMinutes(exc.startTime);
          const excEndMin = parseHHmmToMinutes(exc.endTime);
          
          return min < excEndMin && slotEndMin > excStartMin;
        }
      }
      return false;
    });

    if (hasException) {
      continue;
    }

    slots.push(slotTime);
  }

  return slots;
}

