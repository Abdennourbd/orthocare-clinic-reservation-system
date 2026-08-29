import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  NotificationType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { sendMessage } from "@/lib/messaging/index";
import type { MessageProvider } from "@/lib/messaging/provider";
import { notifyBookingCreated } from "@/lib/messaging/notifyBookingCreated";
import { sendAppointmentRescheduled } from "@/lib/messaging/appointmentChanges";
import { AppointmentNotConfirmedError } from "@/lib/selfservice/errors";
import { POST as postAppointments } from "@/app/api/appointments/route";
import { localStart, nextOpenLocalDate } from "./helpers/testDates";

let serviceId: string;
let activeStaffIds: string[];
// Computed fresh each test from the workingHours fixture inserted in
// beforeEach below — see tests/integration/helpers/testDates.ts for why this
// isn't a literal "2026-08-29" string.
let openDate: string;

afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  const prisma = getPrisma();

  const service = await prisma.service.create({
    data: {
      slug: "consultation-30",
      name: { fr: "Consultation", ar: "استشارة", en: "Consultation" },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
  serviceId = service.id;

  const active = await Promise.all([
    prisma.user.create({
      data: {
        name: "Staff A",
        email: "staff-a@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    }),
    prisma.user.create({
      data: {
        name: "Staff B",
        email: "staff-b@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    }),
  ]);
  activeStaffIds = active.map((u) => u.id);

  await prisma.user.create({
    data: {
      name: "Staff Inactive",
      email: "staff-inactive@orthocare.com",
      passwordHash: "dummyhash",
      role: Role.RECEPTIONIST,
      active: false,
    },
  });

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
      { key: "consentVersion", value: "1.0" },
    ],
  });

  openDate = await nextOpenLocalDate();
});

async function makePatient(overrides: Record<string, unknown> = {}) {
  return getPrisma().patient.create({
    data: {
      firstName: "Yasmine",
      lastName: "Khelifi",
      phone: "0551122334",
      phoneE164: "+213551122334",
      ...overrides,
    },
  });
}

async function makeAppointment(patientId: string) {
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId,
      startTime: localStart(openDate, "11:00"),
      endTime: localStart(openDate, "11:30"),
    },
  });
}

// `date` is a getter, not a literal, so it stays in sync with the openDate
// computed fresh per test in beforeEach (no test asserts on its exact value —
// it only feeds the message template — but it must still describe the same
// appointment `makeAppointment()` creates below).
const vars = {
  firstName: "Yasmine",
  serviceName: "Consultation",
  get date() {
    const [y, m, d] = openDate.split("-");
    return `${d}/${m}/${y}`;
  },
  time: "11:00",
  phone: "0551122334",
};

describe("sendMessage dispatcher", () => {
  it("sends transactional messages even for opted-out patients", async () => {
    const patient = await makePatient({ messagingOptOut: true });
    const appointment = await makeAppointment(patient.id);

    const msg = await sendMessage({
      type: SmsMessageType.BOOKING_RECEIVED,
      patientId: patient.id,
      to: patient.phoneE164,
      appointmentId: appointment.id,
      templateKey: "bookingReceived",
      vars,
    });

    expect(msg).not.toBeNull();
    expect(msg!.to).toBe("+213551122334");
    expect(msg!.type).toBe(SmsMessageType.BOOKING_RECEIVED);
    expect(msg!.provider).toBe("mock");
    expect(msg!.status).toBe(SmsStatus.SENT);
    expect(msg!.templateId).toBe("bookingReceived");
    expect(msg!.sentAt).toBeInstanceOf(Date);
    expect(msg!.body).toContain("confirmer");
    expect(msg!.body).not.toContain("confirmé");
  });

  it("suppresses non-transactional messages for opted-out patients", async () => {
    const patient = await makePatient({ messagingOptOut: true });

    const msg = await sendMessage({
      type: SmsMessageType.WAITLIST,
      patientId: patient.id,
      to: patient.phoneE164,
      templateKey: "bookingReceived",
      vars,
    });

    expect(msg).toBeNull();
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("sends non-transactional messages to patients who did not opt out", async () => {
    const patient = await makePatient({ messagingOptOut: false });

    const msg = await sendMessage({
      type: SmsMessageType.WAITLIST,
      patientId: patient.id,
      to: patient.phoneE164,
      templateKey: "bookingReceived",
      vars,
    });

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe(SmsMessageType.WAITLIST);
  });

  it("is idempotent: a second send for the same appointment+type does not double-message", async () => {
    const patient = await makePatient();
    const appointment = await makeAppointment(patient.id);

    const first = await sendMessage({
      type: SmsMessageType.BOOKING_RECEIVED,
      patientId: patient.id,
      to: patient.phoneE164,
      appointmentId: appointment.id,
      templateKey: "bookingReceived",
      vars,
    });
    const second = await sendMessage({
      type: SmsMessageType.BOOKING_RECEIVED,
      patientId: patient.id,
      to: patient.phoneE164,
      appointmentId: appointment.id,
      templateKey: "bookingReceived",
      vars,
    });

    expect(second!.id).toBe(first!.id);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: appointment.id, type: SmsMessageType.BOOKING_RECEIVED },
      }),
    ).toBe(1);
  });

  it("records a batchId and is queryable by patientId and batchId", async () => {
    const patient = await makePatient();

    const msg = await sendMessage({
      type: SmsMessageType.BOOKING_RECEIVED,
      patientId: patient.id,
      to: patient.phoneE164,
      templateKey: "bookingReceived",
      vars,
      batchId: "batch-1",
    });

    expect(msg!.batchId).toBe("batch-1");
    const byPatient = await getPrisma().smsMessage.findMany({
      where: { patientId: patient.id },
    });
    expect(byPatient).toHaveLength(1);
    const byBatch = await getPrisma().smsMessage.findMany({
      where: { batchId: "batch-1" },
    });
    expect(byBatch).toHaveLength(1);
  });

  it("records FAILED (with error, no sentAt) when the provider returns a failure", async () => {
    vi.stubEnv("MESSAGE_PROVIDER", "twilio");
    const patient = await makePatient();

    const msg = await sendMessage({
      type: SmsMessageType.BOOKING_RECEIVED,
      patientId: patient.id,
      to: patient.phoneE164,
      templateKey: "bookingReceived",
      vars,
    });

    expect(msg).not.toBeNull();
    expect(msg!.status).toBe(SmsStatus.FAILED);
    expect(msg!.provider).toBe("twilio");
    expect(msg!.error).toBeTruthy();
    expect(msg!.sentAt).toBeNull();
  });

  it("records FAILED when the provider throws (never leaves a row SENDING)", async () => {
    const patient = await makePatient();
    const throwingProvider: MessageProvider = {
      name: "mock",
      async send() {
        throw new Error("network down");
      },
    };

    const msg = await sendMessage(
      {
        type: SmsMessageType.BOOKING_RECEIVED,
        patientId: patient.id,
        to: patient.phoneE164,
        templateKey: "bookingReceived",
        vars,
      },
      throwingProvider,
    );

    expect(msg).not.toBeNull();
    expect(msg!.status).toBe(SmsStatus.FAILED);
    expect(msg!.error).toBe("network down");
    expect(msg!.sentAt).toBeNull();
  });

  it("does not retry a FAILED non-transactional message after the patient opts out", async () => {
    const patient = await makePatient({ messagingOptOut: false });
    const appointment = await makeAppointment(patient.id);
    const throwingProvider: MessageProvider = {
      name: "mock",
      async send() {
        throw new Error("network down");
      },
    };

    // First attempt fails and records FAILED.
    const first = await sendMessage(
      {
        type: SmsMessageType.NO_SHOW,
        patientId: patient.id,
        to: patient.phoneE164,
        appointmentId: appointment.id,
        templateKey: "noShow",
        vars,
      },
      throwingProvider,
    );
    expect(first!.status).toBe(SmsStatus.FAILED);

    // The patient opts out before the retry.
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { messagingOptOut: true },
    });

    // The retry must NOT deliver (opt-out re-checked on the retry path).
    const second = await sendMessage(
      {
        type: SmsMessageType.NO_SHOW,
        patientId: patient.id,
        to: patient.phoneE164,
        appointmentId: appointment.id,
        templateKey: "noShow",
        vars,
      },
      {
        name: "mock",
        async send() {
          return { ok: true, status: SmsStatus.SENT };
        },
      },
    );

    expect(second).toBeNull();
    // The row is still FAILED (never delivered), and still exactly one row.
    const rows = await getPrisma().smsMessage.findMany({
      where: { appointmentId: appointment.id, type: SmsMessageType.NO_SHOW },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(SmsStatus.FAILED);
    expect(rows[0].sentAt).toBeNull();
  });

  it("retries a FAILED send on the next call instead of silently skipping it", async () => {
    const patient = await makePatient();
    const appointment = await makeAppointment(patient.id);
    const throwingProvider: MessageProvider = {
      name: "mock",
      async send() {
        throw new Error("network down");
      },
    };

    const first = await sendMessage(
      {
        type: SmsMessageType.BOOKING_RECEIVED,
        patientId: patient.id,
        to: patient.phoneE164,
        appointmentId: appointment.id,
        templateKey: "bookingReceived",
        vars,
      },
      throwingProvider,
    );
    expect(first!.status).toBe(SmsStatus.FAILED);

    // A retry with a healthy provider re-attempts the SAME row (unique
    // index) rather than returning the FAILED row as if nothing was wrong.
    const second = await sendMessage(
      {
        type: SmsMessageType.BOOKING_RECEIVED,
        patientId: patient.id,
        to: patient.phoneE164,
        appointmentId: appointment.id,
        templateKey: "bookingReceived",
        vars,
      },
      {
        name: "mock",
        async send() {
          return { ok: true, status: SmsStatus.SENT };
        },
      },
    );

    expect(second!.id).toBe(first!.id);
    expect(second!.status).toBe(SmsStatus.SENT);
    expect(second!.error).toBeNull();
    expect(second!.sentAt).toBeInstanceOf(Date);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: appointment.id, type: SmsMessageType.BOOKING_RECEIVED },
      }),
    ).toBe(1);
  });
});

describe("notifyBookingCreated", () => {
  it("sends the booking-received message and notifies every ACTIVE staff user", async () => {
    const patient = await makePatient({ preferredLocale: "ar" });
    const appointment = await makeAppointment(patient.id);

    await notifyBookingCreated(appointment.id);

    // Message sent via the mock provider and recorded.
    const msgs = await getPrisma().smsMessage.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe(SmsMessageType.BOOKING_RECEIVED);
    expect(msgs[0].provider).toBe("mock");
    expect(msgs[0].status).toBe(SmsStatus.SENT);
    expect(msgs[0].to).toBe("+213551122334");

    // One NEW_BOOKING notification per ACTIVE staff user; inactive excluded.
    const notifications = await getPrisma().notification.findMany();
    expect(notifications).toHaveLength(activeStaffIds.length);
    for (const n of notifications) {
      expect(n.type).toBe(NotificationType.NEW_BOOKING);
      expect(activeStaffIds).toContain(n.userId);
      // task-13.md étape 6, TOUR 2 [CRITIQUE]: payload must carry NO
      // patient-identifying field — anonymize.ts has no FK-driven way to
      // reach Notification rows, so a name baked in here would survive an
      // erasure request forever. appointmentId is enough for the future
      // dashboard to resolve the name by join at render time.
      const payload = n.payload as { appointmentId: string };
      expect(payload.appointmentId).toBe(appointment.id);
      expect(JSON.stringify(payload)).not.toContain("Yasmine");
      expect(JSON.stringify(payload)).not.toContain("Khelifi");
      expect(payload).not.toHaveProperty("patientName");
    }
  });
});

describe("POST /api/appointments end-to-end", () => {
  it("creates the booking, stores the patient's locale + WhatsApp opt-in, sends the message and notifies staff", async () => {
    const res = await postAppointments(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId,
          startTime: localStart(openDate, "11:00").toISOString(),
          patient: { firstName: "Yasmine", lastName: "Khelifi", phone: "0551122334" },
          consent: true,
          consentVersion: "1.0",
          locale: "ar",
          whatsappOptIn: true,
        }),
      }),
    );
    expect(res.status).toBe(201);

    const patient = await getPrisma().patient.findFirst({
      where: { phoneE164: "+213551122334" },
    });
    expect(patient!.preferredLocale).toBe("ar");
    expect(patient!.whatsappOptIn).toBe(true);

    // Booking-received message recorded (mock provider).
    const msgs = await getPrisma().smsMessage.findMany({
      include: { appointment: true },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe(SmsMessageType.BOOKING_RECEIVED);
    expect(msgs[0].status).toBe(SmsStatus.SENT);
    expect(msgs[0].body).toContain("confirmer");
    expect(msgs[0].body).not.toContain("confirmé");

    // Staff notified.
    expect(await getPrisma().notification.count()).toBe(activeStaffIds.length);
  });

  it("does not send the booking message when the phone is invalid (no booking, no message)", async () => {
    const res = await postAppointments(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId,
          startTime: localStart(openDate, "11:00").toISOString(),
          patient: { firstName: "X", lastName: "Y", phone: "abcdefgh" },
          consent: true,
          consentVersion: "1.0",
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await getPrisma().smsMessage.count()).toBe(0);
    expect(await getPrisma().notification.count()).toBe(0);
  });
});

describe("sendAppointmentRescheduled — CONFIRMED requirement", () => {
  it("refuses to issue a reschedule link for a non-CONFIRMED new appointment", async () => {
    // `createSelfServiceToken` only issues tokens for CONFIRMED appointments,
    // so the reschedule message (which carries the rotated link) must be sent
    // for a CONFIRMED new appointment. Task 14's staff reschedule must pass
    // `newStatus: CONFIRMED` (as `selfServiceReschedule` does) or the patient
    // silently gets no message — this test locks that contract.
    const patient = await makePatient();
    const oldAppointment = await makeAppointment(patient.id);
    const newPending = await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId,
        startTime: localStart(openDate, "12:00"),
        endTime: localStart(openDate, "12:30"),
        status: AppointmentStatus.PENDING,
      },
    });

    await expect(
      sendAppointmentRescheduled(oldAppointment.id, newPending.id),
    ).rejects.toThrow(AppointmentNotConfirmedError);

    // No token and no message were created for the pending appointment.
    expect(
      await getPrisma().selfServiceToken.count({
        where: { appointmentId: newPending.id },
      }),
    ).toBe(0);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: oldAppointment.id, type: SmsMessageType.RESCHEDULE },
      }),
    ).toBe(0);
  });
});