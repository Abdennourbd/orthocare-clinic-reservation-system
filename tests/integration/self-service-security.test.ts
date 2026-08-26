import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  Role,
  SmsMessageType,
} from "@/generated/prisma/client";
import { sendAppointmentConfirmation } from "@/lib/messaging/appointmentChanges";
import { createSelfServiceToken, verifySelfServiceToken } from "@/lib/selfservice/tokens";
import { GET as getAppointment } from "@/app/api/appointments/[token]/route";
import { POST as postCancel } from "@/app/api/appointments/[token]/cancel/route";
import { POST as postReschedule } from "@/app/api/appointments/[token]/reschedule/route";
import { POST as postBooking } from "@/app/api/appointments/route";

// Security tests: each one attempts an attack against the self-service link
// and asserts the defence holds. Grouped by STRIDE threat.

let serviceId: string;

const DAY = "2026-09-10"; // a Thursday (working day)

function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

const request = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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

  await prisma.user.create({
    data: {
      name: "Staff",
      email: "staff@orthocare.com",
      passwordHash: "dummyhash",
      role: Role.RECEPTIONIST,
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
        value: {
          granularityMinutes: 15,
          bufferMinutes: 5,
          lunchBreak: { start: "13:00", end: "14:00" },
        },
      },
      { key: "consentVersion", value: "1.0" },
      {
        key: "clinicInfo",
        value: { name: "Ortho'Care Clinic", address: "Alger", phone: "023 45 67 89" },
      },
    ],
  });
});

async function bookOnline(hhmm: string, day = DAY): Promise<string> {
  const res = await postBooking(
    request("POST", "/api/appointments", {
      serviceId,
      startTime: localStart(day, hhmm).toISOString(),
      patient: { firstName: "Yasmine", lastName: "Khelifi", phone: "0551122334" },
      consent: true,
      consentVersion: "1.0",
      locale: "fr",
      whatsappOptIn: false,
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { appointment: { id: string } };
  return body.appointment.id;
}

async function confirmAndToken(appointmentId: string): Promise<string> {
  await getPrisma().appointment.update({
    where: { id: appointmentId },
    data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() },
  });
  const raw = await sendAppointmentConfirmation(appointmentId);
  expect(raw).not.toBeNull();
  return raw!;
}

async function statusOf(res: Response): Promise<number> {
  return res.status;
}

describe("tampering: reschedule into forbidden slots", () => {
  it("rejects a reschedule into a PAST date", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const res = await postReschedule(
      request("POST", `/api/appointments/${token}/reschedule`, {
        startTime: "2020-01-01T10:00:00.000Z",
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SLOT_CONFLICT",
    );

    const appt = await getPrisma().appointment.findUniqueOrThrow({ where: { id } });
    expect(appt.status).toBe(AppointmentStatus.CONFIRMED); // untouched
  });

  it("rejects a reschedule beyond the booking horizon", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const res = await postReschedule(
      request("POST", `/api/appointments/${token}/reschedule`, {
        startTime: localStart("2030-01-01", "10:00").toISOString(),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(409);
  });

  it("rejects a reschedule into a closure date", async () => {
    const staff = await getPrisma().user.findFirstOrThrow();
    await getPrisma().scheduleException.create({
      data: {
        startDate: localStart("2026-09-17", "00:00"),
        endDate: localStart("2026-09-17", "23:59"),
        allDay: true,
        reason: { fr: "Fermé", ar: "مغلق", en: "Closed" },
        createdById: staff.id,
      },
    });

    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const res = await postReschedule(
      request("POST", `/api/appointments/${token}/reschedule`, {
        startTime: localStart("2026-09-17", "11:00").toISOString(),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(409);
  });

  it("rejects a reschedule into the lunch break", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    // 13:30–14:00 overlaps the 13:00–14:00 lunch closure.
    const res = await postReschedule(
      request("POST", `/api/appointments/${token}/reschedule`, {
        startTime: localStart(DAY, "13:30").toISOString(),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(409);
  });

  it("rejects a malformed reschedule body", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const res = await postReschedule(
      new Request(`http://localhost/api/appointments/${token}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startTime: "not-a-date" }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("elevation of privilege: acting on non-active / foreign appointments", () => {
  it("cannot cancel a COMPLETED appointment via its token", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);
    await getPrisma().appointment.update({
      where: { id },
      data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
    });

    const res = await postCancel(request("POST", `/api/appointments/${token}/cancel`), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "APPOINTMENT_UNAVAILABLE",
    );
  });

  it("cannot cancel a NO_SHOW appointment via its token", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);
    await getPrisma().appointment.update({
      where: { id },
      data: { status: AppointmentStatus.NO_SHOW, noShowAt: new Date() },
    });

    const res = await postCancel(request("POST", `/api/appointments/${token}/cancel`), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(410);
  });
});

describe("denial of service: token enumeration + header forgery", () => {
  it("rejects token guessing (404) and is rate-limited per trusted IP", async () => {
    const ip = "203.0.113.7";
    const params = { params: Promise.resolve({ token: "guess" }) };
    let last = 0;
    for (let i = 0; i <= 60; i++) {
      const res = await getAppointment(
        request("GET", "/api/appointments/guess", undefined, { "x-real-ip": ip }),
        params,
      );
      last = await statusOf(res);
    }
    expect(last).toBe(429);
  });

  it("a forged x-forwarded-for does NOT bypass the per-IP rate limit", async () => {
    const fixedIp = "198.51.100.23";
    const params = { params: Promise.resolve({ token: "guess" }) };
    let last = 0;
    for (let i = 0; i <= 60; i++) {
      // Each request forges a fresh x-forwarded-for; the limiter must key on
      // the TRUSTED x-real-ip only, so the forgery must not mint a new identity.
      const res = await getAppointment(
        request("GET", "/api/appointments/guess", undefined, {
          "x-real-ip": fixedIp,
          "x-forwarded-for": `1.2.3.${i}`,
        }),
        params,
      );
      last = await statusOf(res);
    }
    expect(last).toBe(429);
  });
});

describe("replay: concurrent double-cancel / double-reschedule", () => {
  it("concurrent cancels: exactly one succeeds, one message, one audit", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        postCancel(request("POST", `/api/appointments/${token}/cancel`), {
          params: Promise.resolve({ token }),
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: id, type: SmsMessageType.CANCELLED },
      }),
    ).toBe(1);
    expect(
      await getPrisma().auditLog.count({
        where: { entityId: id, action: AuditAction.SELF_SERVICE_CANCELLED },
      }),
    ).toBe(1);
  });

  it("concurrent reschedules: exactly one move succeeds", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    const results = await Promise.all(
      ["12:00", "12:15", "12:30"].map((t) =>
        postReschedule(
          request("POST", `/api/appointments/${token}/reschedule`, {
            startTime: localStart(DAY, t).toISOString(),
          }),
          { params: Promise.resolve({ token }) },
        ),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    // The original is RESCHEDULED exactly once and exactly one new CONFIRMED
    // appointment exists for this patient.
    const oldAppt = await getPrisma().appointment.findUniqueOrThrow({ where: { id } });
    expect(oldAppt.status).toBe(AppointmentStatus.RESCHEDULED);
    expect(
      await getPrisma().appointment.count({
        where: { patientId: oldAppt.patientId, status: AppointmentStatus.CONFIRMED },
      }),
    ).toBe(1);
  });
});

describe("information disclosure: minimum disclosure", () => {
  it("the lookup never exposes the patient's phone, email, last name or notes", async () => {
    const id = await bookOnline("11:00");
    const token = await confirmAndToken(id);

    // Add identifying data the page must never reveal.
    await getPrisma().patient.updateMany({
      where: { appointments: { some: { id } } },
      data: { email: "secret@example.com", notes: "clinical note" },
    });

    const res = await getAppointment(
      request("GET", `/api/appointments/${token}?locale=fr`),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("0551122334");
    expect(serialized).not.toContain("+213551122334");
    expect(serialized).not.toContain("Khelifi");
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("clinical note");
  });
});

describe("token minting: only CONFIRMED appointments", () => {
  it("refuses to mint a token for a PENDING appointment", async () => {
    const id = await bookOnline("11:00"); // PENDING
    await expect(createSelfServiceToken(id)).rejects.toThrow();
    expect(
      await getPrisma().selfServiceToken.count({ where: { appointmentId: id } }),
    ).toBe(0);
  });

  it("confirmation is idempotent and never revokes the delivered link", async () => {
    const id = await bookOnline("11:00");
    await getPrisma().appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() },
    });

    const first = await sendAppointmentConfirmation(id);
    const second = await sendAppointmentConfirmation(id);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already SENT — no new token, no rotation

    // The delivered link still works (the concurrency bug this guards against
    // would have left it revoked).
    const verified = await verifySelfServiceToken(first!);
    expect(verified.appointment.id).toBe(id);

    expect(
      await getPrisma().selfServiceToken.count({ where: { appointmentId: id } }),
    ).toBe(1);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: id, type: SmsMessageType.CONFIRMATION },
      }),
    ).toBe(1);
  });
});