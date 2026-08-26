import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  NotificationType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { sendMessage } from "@/lib/messaging/index";
import type { MessageProvider } from "@/lib/messaging/provider";
import { notifyBookingCreated } from "@/lib/messaging/notifyBookingCreated";
import { POST as postAppointments } from "@/app/api/appointments/route";

let serviceId: string;
let activeStaffIds: string[];

function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

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
      startTime: localStart("2026-08-29", "11:00"),
      endTime: localStart("2026-08-29", "11:30"),
    },
  });
}

const vars = {
  firstName: "Yasmine",
  serviceName: "Consultation",
  date: "29/08/2026",
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
      expect((n.payload as { patientName: string }).patientName).toBe(
        "Yasmine Khelifi",
      );
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
          startTime: localStart("2026-08-29", "11:00").toISOString(),
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
          startTime: localStart("2026-08-29", "11:00").toISOString(),
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