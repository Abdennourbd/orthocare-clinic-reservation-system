import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
  NotificationType,
  Role,
  SmsMessageType,
} from "@/generated/prisma/client";
import { sendAppointmentConfirmation } from "@/lib/messaging/appointmentChanges";
import { createSelfServiceToken, verifySelfServiceToken } from "@/lib/selfservice/tokens";
import { GET as getAppointment } from "@/app/api/appointments/[token]/route";
import { POST as postCancel } from "@/app/api/appointments/[token]/cancel/route";
import { POST as postReschedule } from "@/app/api/appointments/[token]/reschedule/route";
import { POST as postBooking } from "@/app/api/appointments/route";
import { GET as getSlots } from "@/app/api/slots/route";

let serviceId: string;
let activeStaffIds: string[];

const DAY = "2026-09-10"; // a Thursday, within working hours (Sat–Thu 10h–17h)

afterEach(() => vi.unstubAllEnvs());

function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

const request = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function getSlotsAvailable(date: string): Promise<string[]> {
  const res = await getSlots(
    request("GET", `/api/slots?serviceId=${serviceId}&date=${date}&locale=fr`),
  );
  const body = (await res.json()) as { available: { startUTC: string }[] };
  return body.available.map((s) => s.startUTC);
}

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
      {
        key: "clinicInfo",
        value: { name: "Ortho'Care Clinic", address: "Alger, Algérie", phone: "023 45 67 89" },
      },
    ],
  });
});

/** Book online via the public route (creates PENDING + patient). */
async function bookOnline(hhmm: string) {
  const res = await postBooking(
    request("POST", "/api/appointments", {
      serviceId,
      startTime: localStart(DAY, hhmm).toISOString(),
      patient: { firstName: "Yasmine", lastName: "Khelifi", phone: "0551122334" },
      consent: true,
      consentVersion: "1.0",
      locale: "ar",
      whatsappOptIn: false,
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    appointment: { id: string };
  };
  return body.appointment.id;
}

/** Confirm the appointment (as staff will in Task 14) and issue its token via
 * the confirmation message. Returns the raw token + the confirmation message. */
async function confirmAndIssueToken(appointmentId: string) {
  await getPrisma().appointment.update({
    where: { id: appointmentId },
    data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() },
  });
  const rawToken = await sendAppointmentConfirmation(appointmentId);
  expect(rawToken).not.toBeNull();
  const message = await getPrisma().smsMessage.findFirstOrThrow({
    where: { appointmentId, type: SmsMessageType.CONFIRMATION },
  });
  return { rawToken: rawToken!, message };
}

describe("GET /api/appointments/[token] — minimum disclosure", () => {
  it("exposes only service, date/time, clinic info and the first name", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);

    const res = await getAppointment(
      request("GET", `/api/appointments/${rawToken}?locale=ar`),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.appointment).toMatchObject({
      serviceName: "استشارة",
      durationMinutes: 30,
      localDate: DAY,
      localTime: "11:00",
    });
    expect(body.patient).toEqual({ firstName: "Yasmine" });
    expect(body.clinic).toMatchObject({ name: "Ortho'Care Clinic", phone: "023 45 67 89" });
    expect(body.meta).toMatchObject({ today: expect.any(String), maxDate: expect.any(String) });

    // Minimum disclosure: never the patient's contact data, last name, or ids.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("0551122334");
    expect(serialized).not.toContain("+213551122334");
    expect(serialized).not.toContain("Khelifi");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("birthDate");
    expect(serialized).not.toContain("notes");
    expect(serialized).not.toContain("appointment.id");
  });

  it("is scoped to its own appointment — one token cannot touch another", async () => {
    const aId = await bookOnline("11:00");
    const bId = await bookOnline("12:00");
    const { rawToken: tokenA } = await confirmAndIssueToken(aId);
    await confirmAndIssueToken(bId);

    // Cancel with A's token affects A only.
    await postCancel(request("POST", `/api/appointments/${tokenA}/cancel`), {
      params: Promise.resolve({ token: tokenA }),
    });
    const a = await getPrisma().appointment.findUniqueOrThrow({ where: { id: aId } });
    const b = await getPrisma().appointment.findUniqueOrThrow({ where: { id: bId } });
    expect(a.status).toBe(AppointmentStatus.CANCELLED);
    expect(b.status).toBe(AppointmentStatus.CONFIRMED);
  });
});

describe("self-service cancel", () => {
  it("frees the slot, marks the token used, messages, notifies staff and audits", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);
    const before = await getSlotsAvailable(DAY);
    expect(before).not.toContain(localStart(DAY, "11:00").toISOString());

    const res = await postCancel(request("POST", `/api/appointments/${rawToken}/cancel`), {
      params: Promise.resolve({ token: rawToken }),
    });
    expect(res.status).toBe(200);

    // Appointment cancelled through releaseSlot with the right reason.
    const appointment = await getPrisma().appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    expect(appointment.status).toBe(AppointmentStatus.CANCELLED);
    expect(appointment.cancelReason).toBe(CancelReason.PATIENT_SELF_SERVICE);
    expect(appointment.cancelledAt).toBeInstanceOf(Date);

    // Slot freed again.
    const after = await getSlotsAvailable(DAY);
    expect(after).toContain(localStart(DAY, "11:00").toISOString());

    // Single-use token marked used.
    const token = await getPrisma().selfServiceToken.findFirstOrThrow({
      where: { appointmentId },
    });
    expect(token.usedAt).toBeInstanceOf(Date);

    // Patient messaged (cancelled).
    const msg = await getPrisma().smsMessage.findFirstOrThrow({
      where: { appointmentId, type: SmsMessageType.CANCELLED },
    });
    expect(msg.to).toBe("+213551122334");
    expect(msg.body).toContain("annulé");

    // Staff notified (CANCELLATION, one per active user).
    const notifications = await getPrisma().notification.findMany({
      where: { type: NotificationType.CANCELLATION },
    });
    expect(notifications).toHaveLength(activeStaffIds.length);

    // Audited with actor PATIENT.
    const audit = await getPrisma().auditLog.findFirstOrThrow({
      where: { entityId: appointmentId, action: AuditAction.SELF_SERVICE_CANCELLED },
    });
    expect(audit.actorType).toBe(AuditActorType.PATIENT);
    expect(audit.userId).toBeNull();

    // Reusing the (now used) token is rejected.
    const reuse = await postCancel(request("POST", `/api/appointments/${rawToken}/cancel`), {
      params: Promise.resolve({ token: rawToken }),
    });
    expect(reuse.status).toBe(410);
    const body = (await reuse.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_USED");
  });
});

describe("self-service reschedule", () => {
  it("moves into an available slot as CONFIRMED, rotates the token, messages and audits", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);

    const res = await postReschedule(
      request("POST", `/api/appointments/${rawToken}/reschedule`, {
        startTime: localStart(DAY, "12:00").toISOString(),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(200);

    // Old appointment RESCHEDULED, new one CONFIRMED at the new time.
    const oldAppointment = await getPrisma().appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    expect(oldAppointment.status).toBe(AppointmentStatus.RESCHEDULED);
    expect(oldAppointment.cancelReason).toBe(CancelReason.PATIENT_SELF_SERVICE);

    const newAppointment = await getPrisma().appointment.findFirstOrThrow({
      where: { patientId: oldAppointment.patientId, status: AppointmentStatus.CONFIRMED },
      orderBy: { createdAt: "desc" },
    });
    expect(newAppointment.id).not.toBe(appointmentId);
    expect(newAppointment.startTime.toISOString()).toBe(
      localStart(DAY, "12:00").toISOString(),
    );

    // Slot availability reflects the change.
    const slots = await getSlotsAvailable(DAY);
    expect(slots).toContain(localStart(DAY, "11:00").toISOString());
    expect(slots).not.toContain(localStart(DAY, "12:00").toISOString());

    // Old token dead (rotated), new token live for the new appointment.
    await expect(
      verifySelfServiceToken(rawToken),
    ).rejects.toThrow();
    const oldToken = await getPrisma().selfServiceToken.findFirstOrThrow({
      where: { appointmentId },
    });
    expect(oldToken.usedAt).toBeInstanceOf(Date);
    expect(oldToken.revokedAt).toBeInstanceOf(Date);

    // Reschedule message carries the fresh link.
    const msg = await getPrisma().smsMessage.findFirstOrThrow({
      where: { appointmentId, type: SmsMessageType.RESCHEDULE },
    });
    expect(msg.body).toContain("/ar/appointment/");
    const linkToken = msg.body.match(/\/ar\/appointment\/([A-Za-z0-9_-]+)/)?.[1];
    expect(linkToken).toBeTruthy();
    const verified = await verifySelfServiceToken(linkToken!);
    expect(verified.appointment.id).toBe(newAppointment.id);

    // Audited with actor PATIENT.
    const audit = await getPrisma().auditLog.findFirstOrThrow({
      where: { entityId: appointmentId, action: AuditAction.SELF_SERVICE_RESCHEDULED },
    });
    expect(audit.actorType).toBe(AuditActorType.PATIENT);
    expect((audit.detail as { newAppointmentId: string }).newAppointmentId).toBe(
      newAppointment.id,
    );
  });

  it("rejects a reschedule into an occupied slot — nothing changes", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);

    // Another patient occupies 13:00 (far from the 11:00 slot, no buffer
    // adjacency).
    await bookOnline("13:00");

    const res = await postReschedule(
      request("POST", `/api/appointments/${rawToken}/reschedule`, {
        startTime: localStart(DAY, "13:00").toISOString(),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SLOT_CONFLICT");

    // The original appointment is untouched and the token still works.
    const appointment = await getPrisma().appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment.startTime.toISOString()).toBe(localStart(DAY, "11:00").toISOString());
    await expect(verifySelfServiceToken(rawToken)).resolves.toBeTruthy();
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId, type: SmsMessageType.RESCHEDULE },
      }),
    ).toBe(0);
    expect(
      await getPrisma().auditLog.count({
        where: { action: AuditAction.SELF_SERVICE_RESCHEDULED },
      }),
    ).toBe(0);
  });
});

describe("self-service token negative tests", () => {
  it("rejects an unknown token", async () => {
    const res = await getAppointment(request("GET", "/api/appointments/nope"), {
      params: Promise.resolve({ token: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an expired token", async () => {
    const appointmentId = await bookOnline("11:00");
    await getPrisma().appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    const { rawToken } = await createSelfServiceToken(appointmentId);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await getAppointment(request("GET", `/api/appointments/${rawToken}`), {
      params: Promise.resolve({ token: rawToken }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a revoked token", async () => {
    const appointmentId = await bookOnline("11:00");
    await getPrisma().appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    const { rawToken } = await createSelfServiceToken(appointmentId);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId },
      data: { revokedAt: new Date() },
    });

    const res = await postCancel(request("POST", `/api/appointments/${rawToken}/cancel`), {
      params: Promise.resolve({ token: rawToken }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_REVOKED");
  });

  it("rejects a token whose appointment is no longer active", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);
    await getPrisma().appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
    });

    const res = await getAppointment(request("GET", `/api/appointments/${rawToken}`), {
      params: Promise.resolve({ token: rawToken }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("APPOINTMENT_UNAVAILABLE");
  });

  it("rejects a cross-site cancel (CSRF origin guard)", async () => {
    // The origin guard is only strict once APP_URL is configured (as it is in
    // production); without it the site is permissive for local dev.
    vi.stubEnv("APP_URL", "https://orthocare-clinic.vercel.app");
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);

    const res = await postCancel(
      new Request(`http://localhost/api/appointments/${rawToken}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("self-service reschedule negative tests", () => {
  it("rejects a reschedule with a used token (no double move)", async () => {
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId },
      data: { usedAt: new Date() },
    });

    const res = await postReschedule(
      request("POST", `/api/appointments/${rawToken}/reschedule`, {
        startTime: localStart(DAY, "12:00").toISOString(),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_USED");
  });

  it("rejects a reschedule with an expired token", async () => {
    const appointmentId = await bookOnline("11:00");
    await getPrisma().appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    const { rawToken } = await createSelfServiceToken(appointmentId);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await postReschedule(
      request("POST", `/api/appointments/${rawToken}/reschedule`, {
        startTime: localStart(DAY, "12:00").toISOString(),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a reschedule with a revoked token", async () => {
    const appointmentId = await bookOnline("11:00");
    await getPrisma().appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    const { rawToken } = await createSelfServiceToken(appointmentId);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId },
      data: { revokedAt: new Date() },
    });

    const res = await postReschedule(
      request("POST", `/api/appointments/${rawToken}/reschedule`, {
        startTime: localStart(DAY, "12:00").toISOString(),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN_REVOKED");
  });

  it("rejects a cross-site reschedule (CSRF origin guard)", async () => {
    vi.stubEnv("APP_URL", "https://orthocare-clinic.vercel.app");
    const appointmentId = await bookOnline("11:00");
    const { rawToken } = await confirmAndIssueToken(appointmentId);

    const res = await postReschedule(
      new Request(`http://localhost/api/appointments/${rawToken}/reschedule`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ startTime: localStart(DAY, "12:00").toISOString() }),
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("self-service rate limiting", () => {
  it("rejects lookups beyond the per-IP limit", async () => {
    const ip = "203.0.113.99";
    const params = { params: Promise.resolve({ token: "whatever" }) };
    let lastStatus = 0;
    // 60 lookups are allowed per hour; the 61st is rejected.
    for (let i = 0; i <= 60; i++) {
      const res = await getAppointment(
        request("GET", "/api/appointments/whatever", undefined, { "x-real-ip": ip }),
        params,
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});