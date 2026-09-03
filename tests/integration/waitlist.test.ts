import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  CancelReason,
  SmsMessageType,
  SmsStatus,
  WaitlistSource,
} from "@/generated/prisma/client";
import { releaseSlot, AppointmentAlreadyReleasedError } from "@/lib/booking/releaseSlot";
import { rescheduleSlot } from "@/lib/booking/rescheduleSlot";
import { createBooking } from "@/lib/booking/createBooking";
import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
  addClinicDays,
} from "@/lib/time/clinicTime";
import { localStart, nextOpenLocalDate } from "./helpers/testDates";

// Task 17.4 — waitlist slot-freed integration: releaseSlot/rescheduleSlot emit,
// notifyWaitlist consumes. Every scenario uses synthetic patients/services only.
// The subscriber runs fire-and-forget (releaseSlot emits, handleSlotFreed runs
// async), so each trigger polls until the entry flips or the deadline hits.

let seq = 0;

function uniqPhone(): { phone: string; phoneE164: string } {
  seq++;
  const suffix = String(seq).padStart(4, "0");
  const phone = `05519${suffix.slice(-2)}${String(1000 + seq).slice(-4)}`.slice(0, 10);
  return { phone, phoneE164: `+213${phone.slice(1)}` };
}

async function createService(name = "Consultation") {
  seq++;
  return getPrisma().service.create({
    data: {
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-wl-${Date.now()}-${seq}`,
      name: { fr: name, ar: "استشارة", en: name },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
}

async function createPatient(overrides: Record<string, unknown> = {}) {
  const { phone, phoneE164 } = uniqPhone();
  seq++;
  return getPrisma().patient.create({
    data: {
      firstName: "Sara",
      lastName: `Benali${seq}`,
      phone,
      phoneE164,
      firstNameNormalized: "sara",
      lastNameNormalized: `benali${seq}`,
      ...(overrides as Record<string, string>),
    },
  });
}

async function createConfirmedAppointment(
  patientId: string,
  serviceId: string,
  startTime: Date,
) {
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId,
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60000),
      status: AppointmentStatus.CONFIRMED,
    },
  });
}

async function createWaitlistEntry(
  patientId: string,
  serviceId: string,
  watchDates: string[],
  source: WaitlistSource = WaitlistSource.STAFF,
) {
  return getPrisma().waitlistEntry.create({
    data: {
      patientId,
      serviceId,
      preferredDates: watchDates.map((d) => getClinicDayBoundsUTC(d).startUTC),
      source,
    },
  });
}

/** Poll until `fn` returns truthy; throws on timeout so failures show state. */
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error("waitFor: timed out waiting for waitlist notify");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitForEntryInactive(entryId: string): Promise<void> {
  await waitFor(async () => {
    const e = await getPrisma().waitlistEntry.findUnique({ where: { id: entryId } });
    return e?.active === false;
  });
}

async function waitForWaitlistSms(patientId: string): Promise<void> {
  await waitFor(async () => {
    const c = await getPrisma().smsMessage.count({
      where: { type: SmsMessageType.WAITLIST, patientId },
    });
    return c >= 1;
  });
}

beforeEach(async () => {
  await getPrisma().setting.createMany({
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
});

describe("waitlist slot-freed via releaseSlot/rescheduleSlot (Task 17.4)", () => {
  it("staff cancel notifies the Day X service-A waiter only (P3/P4 silent + active)", async () => {
    const serviceA = await createService("Consultation A");
    const serviceB = await createService("Consultation B");
    const dayX = await nextOpenLocalDate(5);
    const otherDate = addClinicDays(dayX, 2);

    const p1 = await createPatient();
    const p2 = await createPatient();
    const p3 = await createPatient();
    const p4 = await createPatient();

    const appt = await createConfirmedAppointment(p1.id, serviceA.id, localStart(dayX, "11:00"));
    // Sanity: the freed slot really maps to Day X clinic-local.
    expect(toClinicLocalDateString(appt.startTime)).toBe(dayX);

    const e2 = await createWaitlistEntry(p2.id, serviceA.id, [dayX], WaitlistSource.STAFF);
    const e3 = await createWaitlistEntry(p3.id, serviceA.id, [otherDate], WaitlistSource.STAFF);
    const e4 = await createWaitlistEntry(p4.id, serviceB.id, [dayX], WaitlistSource.STAFF);

    await releaseSlot(appt.id, CancelReason.STAFF);
    await waitForEntryInactive(e2.id);
    await waitForWaitlistSms(p2.id);

    // P2: one WAITLIST SMS, entry consumed with notifiedAt.
    const sms = await getPrisma().smsMessage.findMany({
      where: { type: SmsMessageType.WAITLIST, patientId: p2.id },
    });
    expect(sms).toHaveLength(1);
    expect(sms[0].status).toBe(SmsStatus.SENT);
    expect(sms[0].appointmentId).toBeNull();
    const after2 = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: e2.id } });
    expect(after2.active).toBe(false);
    expect(after2.notifiedAt).toBeInstanceOf(Date);

    // P3 (different date) + P4 (different service): silent and still active.
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: p3.id },
      }),
    ).toBe(0);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: p4.id },
      }),
    ).toBe(0);
    for (const id of [e3.id, e4.id]) {
      const e = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id } });
      expect(e.active).toBe(true);
      expect(e.notifiedAt).toBeNull();
    }
    expect(
      await getPrisma().smsMessage.count({ where: { type: SmsMessageType.WAITLIST } }),
    ).toBe(1);
  });

  it("self-service cancel notifies a PATIENT-source entry created via createBooking watchDates", async () => {
    const service = await createService();
    const dayBook = await nextOpenLocalDate(5);
    let dayWatch = await nextOpenLocalDate(6);
    if (dayWatch === dayBook) dayWatch = addClinicDays(dayBook, 1);

    // Watcher books DayBook while watching DayWatch (PATIENT source).
    const { phone, phoneE164 } = uniqPhone();
    const { patient: watcher, waitlistEntry } = await createBooking({
      serviceId: service.id,
      startUTC: localStart(dayBook, "11:00"),
      patient: {
        firstName: "Yasmine",
        lastName: "Khelifi",
        phone,
        phoneE164,
        consentAt: new Date(),
        consentVersion: "1.0",
        preferredLocale: "fr",
        whatsappOptIn: false,
      },
      watchDates: [dayWatch],
    });
    expect(waitlistEntry).not.toBeNull();

    // Victim holds the watched day; self-service cancel frees it.
    const victim = await createPatient();
    const victimAppt = await createConfirmedAppointment(
      victim.id,
      service.id,
      localStart(dayWatch, "11:00"),
    );

    await releaseSlot(victimAppt.id, CancelReason.PATIENT_SELF_SERVICE);
    await waitForEntryInactive(waitlistEntry!.id);

    const sms = await getPrisma().smsMessage.findMany({
      where: { type: SmsMessageType.WAITLIST, patientId: watcher.id },
    });
    expect(sms).toHaveLength(1);
    expect(sms[0].appointmentId).toBeNull();
    const after = await getPrisma().waitlistEntry.findUniqueOrThrow({
      where: { id: waitlistEntry!.id },
    });
    expect(after.active).toBe(false);
    expect(after.notifiedAt).toBeInstanceOf(Date);
  });

  it("auto-expiry release fires the waitlist", async () => {
    const service = await createService();
    const dayX = await nextOpenLocalDate(5);
    const holder = await createPatient();
    const waiter = await createPatient();
    const appt = await createConfirmedAppointment(holder.id, service.id, localStart(dayX, "11:00"));
    const entry = await createWaitlistEntry(waiter.id, service.id, [dayX]);

    await releaseSlot(appt.id, CancelReason.AUTO_EXPIRED);
    await waitForEntryInactive(entry.id);

    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: waiter.id },
      }),
    ).toBe(1);
    const after = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.active).toBe(false);
    expect(after.notifiedAt).toBeInstanceOf(Date);
  });

  it("reschedule notifies the old-day waiter, not the new-day waiter", async () => {
    const service = await createService();
    const dayX = await nextOpenLocalDate(5);
    let dayY = await nextOpenLocalDate(8);
    if (dayY === dayX) dayY = addClinicDays(dayX, 3);

    const holder = await createPatient();
    const waiterX = await createPatient();
    const waiterY = await createPatient();
    const appt = await createConfirmedAppointment(holder.id, service.id, localStart(dayX, "11:00"));
    const entryX = await createWaitlistEntry(waiterX.id, service.id, [dayX]);
    const entryY = await createWaitlistEntry(waiterY.id, service.id, [dayY]);

    await rescheduleSlot({
      appointmentId: appt.id,
      newStartUTC: localStart(dayY, "11:00"),
      reason: CancelReason.STAFF,
    });
    await waitForEntryInactive(entryX.id);

    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: waiterX.id },
      }),
    ).toBe(1);
    // The new day was *booked*, not freed — its waiter stays silent + active.
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: waiterY.id },
      }),
    ).toBe(0);
    const afterY = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entryY.id } });
    expect(afterY.active).toBe(true);
    expect(afterY.notifiedAt).toBeNull();
  });

  it("an opted-out waiter is suppressed and stays active", async () => {
    const service = await createService();
    const dayX = await nextOpenLocalDate(5);
    const holder = await createPatient();
    const waiter = await createPatient({ messagingOptOut: true });
    const appt = await createConfirmedAppointment(holder.id, service.id, localStart(dayX, "11:00"));
    const entry = await createWaitlistEntry(waiter.id, service.id, [dayX]);

    await releaseSlot(appt.id, CancelReason.STAFF);
    // Give the fire-and-forget subscriber time to run, then assert silence.
    await new Promise((r) => setTimeout(r, 500));

    expect(
      await getPrisma().smsMessage.count({ where: { type: SmsMessageType.WAITLIST } }),
    ).toBe(0);
    const after = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.active).toBe(true);
    expect(after.notifiedAt).toBeNull();
  });

  it("a consumed entry is not re-notified on a second cancellation", async () => {
    const service = await createService();
    const dayX = await nextOpenLocalDate(5);
    const holder1 = await createPatient();
    const holder2 = await createPatient();
    const waiter = await createPatient();
    const appt1 = await createConfirmedAppointment(holder1.id, service.id, localStart(dayX, "11:00"));
    const appt2 = await createConfirmedAppointment(holder2.id, service.id, localStart(dayX, "13:00"));
    const entry = await createWaitlistEntry(waiter.id, service.id, [dayX]);

    await releaseSlot(appt1.id, CancelReason.STAFF);
    await waitForEntryInactive(entry.id);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: waiter.id },
      }),
    ).toBe(1);

    await releaseSlot(appt2.id, CancelReason.STAFF);
    await new Promise((r) => setTimeout(r, 500));
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST, patientId: waiter.id },
      }),
    ).toBe(1);
    const after = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.active).toBe(false);
  });

  it("double-release of the same appointment emits only once", async () => {
    const service = await createService();
    const dayX = await nextOpenLocalDate(5);
    const holder = await createPatient();
    const waiter = await createPatient();
    const appt = await createConfirmedAppointment(holder.id, service.id, localStart(dayX, "11:00"));
    const entry = await createWaitlistEntry(waiter.id, service.id, [dayX]);

    await releaseSlot(appt.id, CancelReason.STAFF);
    await waitForEntryInactive(entry.id);

    await expect(releaseSlot(appt.id, CancelReason.STAFF)).rejects.toBeInstanceOf(
      AppointmentAlreadyReleasedError,
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(
      await getPrisma().smsMessage.count({ where: { type: SmsMessageType.WAITLIST } }),
    ).toBe(1);
  });
});
