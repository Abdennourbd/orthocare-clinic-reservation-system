import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  CancelReason,
} from "@/generated/prisma/client";
import { bookSlot, SlotConflictError } from "@/lib/booking/bookSlot";
import {
  releaseSlot,
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "@/lib/booking/releaseSlot";
import { rescheduleSlot } from "@/lib/booking/rescheduleSlot";
import { onSlotFreed } from "@/lib/booking/events";
import {
  localStart,
  nextOpenLocalDate,
  nextClosedLocalDate,
} from "./helpers/testDates";

let patientId: string;
let serviceId: string;
// Computed fresh each test from the workingHours fixture just inserted below
// — see tests/integration/helpers/testDates.ts for why these aren't literal
// "2026-08-29" strings.
let openDate: string;
let closedDate: string;

beforeEach(async () => {
  const prisma = getPrisma();

  const patient = await prisma.patient.create({
    data: {
      firstName: "Samir",
      lastName: "Benali",
      phone: "0550998877",
      phoneE164: "+213550998877",
    },
  });
  patientId = patient.id;

  const service = await prisma.service.create({
    data: {
      slug: "consultation-30",
      name: { fr: "Consultation", ar: "استشارة", en: "Consultation" },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
  serviceId = service.id;

  await prisma.setting.createMany({
    data: [
      {
        key: "workingHours",
        value: {
          sat: { open: "10:00", close: "17:00" },
          sun: { open: "10:00", close: "17:00" },
          mon: { open: "10:00", close: "17:00" },
          tue: { open: "10:00", close: "17:00" },
          wed: { open: "10:00", close: "17:00" },
          thu: { open: "10:00", close: "17:00" },
          fri: { closed: true },
        },
      },
      {
        key: "bookingPolicy",
        value: {
          pendingExpiryHours: 24,
          minLeadTimeMinutes: 0,
          maxHorizonDays: 90,
          clinicTimezone: "Africa/Algiers",
        },
      },
      {
        key: "slotConfig",
        value: { granularityMinutes: 15, bufferMinutes: 5, lunchBreak: null },
      },
    ],
  });

  openDate = await nextOpenLocalDate();
  closedDate = await nextClosedLocalDate();
});

describe("bookSlot", () => {
  it("creates a PENDING appointment with endTime derived from service duration", async () => {
    const appt = await bookSlot({
      patientId,
      serviceId,
      startUTC: localStart(openDate, "11:00"), // 10:00 UTC
    });

    expect(appt.status).toBe(AppointmentStatus.PENDING);
    expect(appt.source).toBe(AppointmentSource.ONLINE);
    expect(appt.startTime.toISOString()).toBe(`${openDate}T10:00:00.000Z`);
    // 30-min service -> end = 11:30 local = 10:30 UTC
    expect(appt.endTime.toISOString()).toBe(`${openDate}T10:30:00.000Z`);
    expect(appt.resourceId).toBeNull();
  });

  it("rejects a slot outside working hours with a SlotConflictError", async () => {
    // 09:00 local is before the 10:00 open.
    await expect(
      bookSlot({
        patientId,
        serviceId,
        startUTC: localStart(openDate, "09:00"),
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it("rejects a slot on a closed day (Friday)", async () => {
    await expect(
      bookSlot({
        patientId,
        serviceId,
        startUTC: localStart(closedDate, "11:00"), // Friday, closed
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it("enforces lead time against the real clock (stale client can't bypass)", async () => {
    // bookSlot re-checks with `new Date()`, not a client-provided time. Set a
    // huge lead time so even this near-future slot is inside the lead
    // window and must be rejected.
    await getPrisma().setting.update({
      where: { key: "bookingPolicy" },
      data: { value: { minLeadTimeMinutes: 525600, maxHorizonDays: 90 } },
    });

    await expect(
      bookSlot({
        patientId,
        serviceId,
        startUTC: localStart(openDate, "11:00"),
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it("allows exactly one of two concurrent bookings of the same slot", async () => {
    const startUTC = localStart(openDate, "11:00");
    const results = await Promise.allSettled([
      bookSlot({ patientId, serviceId, startUTC }),
      bookSlot({ patientId, serviceId, startUTC }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      SlotConflictError,
    );

    const count = await getPrisma().appointment.count({ where: { serviceId } });
    expect(count).toBe(1);
  });

  it("rejects a second booking that overlaps the first (with buffer)", async () => {
    const startUTC = localStart(openDate, "11:00");
    await bookSlot({ patientId, serviceId, startUTC });

    // 30-min service; next candidate at 11:15 local would overlap the
    // first's buffer (11:00-11:35 local blocked).
    await expect(
      bookSlot({
        patientId,
        serviceId,
        startUTC: localStart(openDate, "11:15"),
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });
});

describe("releaseSlot", () => {
  it("cancels the appointment, records the reason, and frees the slot", async () => {
    const startUTC = localStart(openDate, "11:00");
    const appt = await bookSlot({ patientId, serviceId, startUTC });

    const freed: unknown[] = [];
    const off = onSlotFreed((e) => {
      freed.push(e);
    });

    const released = await releaseSlot(appt.id, CancelReason.STAFF);

    expect(released.status).toBe(AppointmentStatus.CANCELLED);
    expect(released.cancelReason).toBe(CancelReason.STAFF);
    expect(released.cancelledAt).toBeInstanceOf(Date);

    // Event fired with the original window and the service (the waitlist
    // subscriber matches on serviceId).
    expect(freed).toHaveLength(1);
    expect(freed[0]).toMatchObject({
      appointmentId: appt.id,
      serviceId,
      startTime: startUTC,
      endTime: new Date(startUTC.getTime() + 30 * 60_000),
    });

    // Slot is free again: booking the same time now succeeds.
    const rebuk = await bookSlot({ patientId, serviceId, startUTC });
    expect(rebuk.id).toBeDefined();

    off();
  });

  it("throws AppointmentNotFoundError for a missing appointment", async () => {
    await expect(releaseSlot("missing-id", CancelReason.STAFF)).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
  });

  it("throws AppointmentAlreadyReleasedError when released twice", async () => {
    const appt = await bookSlot({
      patientId,
      serviceId,
      startUTC: localStart(openDate, "12:00"),
    });
    await releaseSlot(appt.id, CancelReason.PATIENT_SELF_SERVICE);

    await expect(
      releaseSlot(appt.id, CancelReason.AUTO_EXPIRED),
    ).rejects.toBeInstanceOf(AppointmentAlreadyReleasedError);
  });
});

describe("rescheduleSlot", () => {
  it("atomically releases the old slot, books the new one, and emits slot-freed", async () => {
    const oldStart = localStart(openDate, "11:00");
    const newStart = localStart(openDate, "14:00");
    const appt = await bookSlot({ patientId, serviceId, startUTC: oldStart });

    const freed: unknown[] = [];
    const off = onSlotFreed((e) => {
      freed.push(e);
    });

    const { oldAppointment, newAppointment } = await rescheduleSlot({
      appointmentId: appt.id,
      newStartUTC: newStart,
      reason: CancelReason.PATIENT_SELF_SERVICE,
    });

    expect(oldAppointment.status).toBe(AppointmentStatus.RESCHEDULED);
    // The reason parameter (not a hardcoded STAFF) is recorded.
    expect(oldAppointment.cancelReason).toBe(CancelReason.PATIENT_SELF_SERVICE);
    expect(oldAppointment.cancelledAt).toBeInstanceOf(Date);

    expect(newAppointment.patientId).toBe(patientId);
    expect(newAppointment.serviceId).toBe(serviceId);
    expect(newAppointment.startTime.toISOString()).toBe(
      newStart.toISOString(),
    );

    // The old appointment's slot-freed event fired (after commit).
    expect(freed).toHaveLength(1);
    expect(freed[0]).toMatchObject({ appointmentId: appt.id });

    // Old slot is free again.
    const rebook = await bookSlot({ patientId, serviceId, startUTC: oldStart });
    expect(rebook.id).toBeDefined();

    off();
  });

  it("rolls back the old appointment when the new slot is taken", async () => {
    const oldStart = localStart(openDate, "11:00");
    const newStart = localStart(openDate, "14:00");
    const appt = await bookSlot({ patientId, serviceId, startUTC: oldStart });
    // Occupy the target slot.
    await bookSlot({ patientId, serviceId, startUTC: newStart });

    await expect(
      rescheduleSlot({
        appointmentId: appt.id,
        newStartUTC: newStart,
        reason: CancelReason.STAFF,
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);

    // Atomicity: the old appointment was NOT released — it is still active.
    const after = await getPrisma().appointment.findUnique({
      where: { id: appt.id },
    });
    expect(after?.status).toBe(AppointmentStatus.PENDING);

    // No new appointment was created for the target slot beyond the occupant.
    const targetCount = await getPrisma().appointment.count({
      where: {
        serviceId,
        startTime: newStart,
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      },
    });
    expect(targetCount).toBe(1);
  });
});
