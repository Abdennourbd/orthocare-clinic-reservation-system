import { Prisma } from "@/generated/prisma/client";
import {
  AppointmentStatus,
  type Appointment,
  type Service,
  type Setting,
  type ScheduleException,
} from "@/generated/prisma/client";
import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import type { WorkingHoursSetting } from "@/lib/slots/workingHours";
import type {
  SlotBookabilityInput,
  SlotEngineInput,
} from "@/lib/slots/engine";

// The pure slot engine deliberately takes its inputs as plain values. These
// helpers load those inputs from the DB (the engine's caller's job) so both
// `generateSlots`/`getDaySlotOverview` (Task 4/6) and `bookSlot` (Task 5) can
// be fed the same shape.

export type SlotConfigValue = {
  granularityMinutes?: number;
  bufferMinutes?: number;
  lunchBreak?: { start: string; end: string } | null;
};

export type BookingPolicyValue = {
  pendingExpiryHours?: number;
  minLeadTimeMinutes?: number;
  maxHorizonDays?: number;
  clinicTimezone?: string;
};

export type LoadSlotContextOptions = {
  serviceId: string;
  resourceId?: string | null;
  startUTC: Date;
  nowUTC: Date;
};

export type LoadDaySlotContextOptions = {
  serviceId: string;
  resourceId?: string | null;
  localDateString: string;
  nowUTC: Date;
};

export type SlotContext = {
  service: Service;
  bookability: SlotBookabilityInput;
};

export type DaySlotContext = {
  service: Service;
  engineInput: SlotEngineInput;
};

type DayData = {
  workingHours: WorkingHoursSetting;
  slotConfig: SlotConfigValue;
  bookingPolicy: BookingPolicyValue;
  exceptions: ScheduleException[];
  appointments: Appointment[];
};

function asWorkingHours(value: Setting["value"] | null | undefined): WorkingHoursSetting {
  return (value ?? {}) as WorkingHoursSetting;
}

function asSlotConfig(value: Setting["value"] | null | undefined): SlotConfigValue {
  return (value ?? {}) as SlotConfigValue;
}

function asBookingPolicy(value: Setting["value"] | null | undefined): BookingPolicyValue {
  return (value ?? {}) as BookingPolicyValue;
}

/**
 * Reads the scheduling settings, the closure exceptions overlapping the day,
 * and the active appointments overlapping the day — the shared inputs of every
 * engine call. Runs on ONE transaction client because interactive
 * transactions pin a single connection (see loadSlotContext).
 */
async function loadDayData(
  tx: Prisma.TransactionClient,
  localDateString: string,
): Promise<DayData> {
  const { startUTC: dayStartUTC, endUTC: dayEndUTC } =
    getClinicDayBoundsUTC(localDateString);

  const workingHoursSetting = await tx.setting.findUnique({ where: { key: "workingHours" } });
  const slotConfigSetting = await tx.setting.findUnique({ where: { key: "slotConfig" } });
  const bookingPolicySetting = await tx.setting.findUnique({ where: { key: "bookingPolicy" } });

  const slotConfig = asSlotConfig(slotConfigSetting?.value);

  // The inter-appointment buffer extends an appointment's blocked window by
  // ±buffer on each side, so an appointment just past the day boundary can
  // still block a slot at the boundary. Expand the fetch window accordingly,
  // otherwise a within-buffer neighbour on the previous/next day is silently
  // dropped and its overlap is never enforced.
  const bufferMs = (slotConfig.bufferMinutes ?? 0) * 60_000;
  const windowStart = new Date(dayStartUTC.getTime() - bufferMs);
  const windowEnd = new Date(dayEndUTC.getTime() + bufferMs);

  const exceptions = await tx.scheduleException.findMany({
    where: {
      startDate: { lte: dayEndUTC },
      endDate: { gte: dayStartUTC },
    },
  });
  const appointments = await tx.appointment.findMany({
    where: {
      // Only active bookings block a slot. Released/completed ones don't.
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
    },
  });

  return {
    workingHours: asWorkingHours(workingHoursSetting?.value),
    slotConfig,
    bookingPolicy: asBookingPolicy(bookingPolicySetting?.value),
    exceptions,
    appointments,
  };
}

/**
 * Loads everything needed to evaluate whether a single slot window is
 * bookable: the service (for duration), the three scheduling settings, the
 * closure exceptions overlapping the day, and the active appointments that
 * overlap the day. Returns a `bookability` input ready for `isSlotBookable`.
 */
export async function loadSlotContext(
  tx: Prisma.TransactionClient,
  opts: LoadSlotContextOptions,
): Promise<SlotContext> {
  const localDateString = toClinicLocalDateString(opts.startUTC);
  const { service, day } = await loadDayContext(tx, {
    serviceId: opts.serviceId,
    resourceId: opts.resourceId,
    localDateString,
    nowUTC: opts.nowUTC,
  });

  const bookability: SlotBookabilityInput = {
    localDateString,
    serviceId: opts.serviceId,
    serviceDurationMinutes: service.durationMinutes,
    workingHours: day.workingHours,
    slotConfig: {
      bufferMinutes: day.slotConfig.bufferMinutes ?? 0,
      lunchBreak: day.slotConfig.lunchBreak ?? null,
    },
    bookingPolicy: {
      maxHorizonDays: day.bookingPolicy.maxHorizonDays ?? 90,
      minLeadTimeMinutes: day.bookingPolicy.minLeadTimeMinutes ?? 0,
      clinicTimezone: day.bookingPolicy.clinicTimezone ?? "Africa/Algiers",
      pendingExpiryHours: day.bookingPolicy.pendingExpiryHours ?? 24,
    },
    exceptions: day.exceptions.map((e: ScheduleException) => ({
      startDate: e.startDate,
      endDate: e.endDate,
      allDay: e.allDay,
      startTime: e.startTime,
      endTime: e.endTime,
      serviceId: e.serviceId,
    })),
    appointments: day.appointments.map((a: Appointment) => ({
      startTime: a.startTime,
      endTime: a.endTime,
      resourceId: a.resourceId,
    })),
    nowUTC: opts.nowUTC,
    resourceId: opts.resourceId,
  };

  return { service, bookability };
}

/**
 * Loads everything `getDaySlotOverview` needs for a whole clinic-local day:
 * the service and a complete `SlotEngineInput` (including granularity) ready
 * for the day overview / slot listing.
 */
export async function loadDaySlotContext(
  tx: Prisma.TransactionClient,
  opts: LoadDaySlotContextOptions,
): Promise<DaySlotContext> {
  const { service, day } = await loadDayContext(tx, opts);

  const engineInput: SlotEngineInput = {
    localDateString: opts.localDateString,
    serviceId: opts.serviceId,
    serviceDurationMinutes: service.durationMinutes,
    workingHours: day.workingHours,
    slotConfig: {
      granularityMinutes: day.slotConfig.granularityMinutes ?? 15,
      bufferMinutes: day.slotConfig.bufferMinutes ?? 0,
      lunchBreak: day.slotConfig.lunchBreak ?? null,
    },
    bookingPolicy: {
      maxHorizonDays: day.bookingPolicy.maxHorizonDays ?? 90,
      minLeadTimeMinutes: day.bookingPolicy.minLeadTimeMinutes ?? 0,
      clinicTimezone: day.bookingPolicy.clinicTimezone ?? "Africa/Algiers",
      pendingExpiryHours: day.bookingPolicy.pendingExpiryHours ?? 24,
    },
    exceptions: day.exceptions.map((e: ScheduleException) => ({
      startDate: e.startDate,
      endDate: e.endDate,
      allDay: e.allDay,
      startTime: e.startTime,
      endTime: e.endTime,
      serviceId: e.serviceId,
    })),
    appointments: day.appointments.map((a: Appointment) => ({
      startTime: a.startTime,
      endTime: a.endTime,
      resourceId: a.resourceId,
    })),
    nowUTC: opts.nowUTC,
    resourceId: opts.resourceId,
  };

  return { service, engineInput };
}

async function loadDayContext(
  tx: Prisma.TransactionClient,
  opts: LoadDaySlotContextOptions,
): Promise<{ service: Service; day: DayData }> {
  const day = await loadDayData(tx, opts.localDateString);

  const service = await tx.service.findUnique({ where: { id: opts.serviceId } });
  if (!service) {
    throw new Error(`Service not found: ${opts.serviceId}`);
  }

  return { service, day };
}
