import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  formatClinicLocalTime,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { localStart, nextOpenLocalDate } from "./helpers/testDates";

// Task 16 — integration tests for the SMS Center routes:
// POST /api/admin/sms/single, /api/admin/sms/broadcast/preview,
// /api/admin/sms/broadcast, GET /api/admin/sms (history) and
// GET /api/admin/sms/batches. Setup mirrors appointments-api.test.ts (users,
// session cookie, NextRequest construction); the mock provider records every
// send as an SmsMessage row we can assert on.
//
// Broadcast fixtures are seeded on the CLINIC-local today (computed via
// toClinicLocalDateString + localStart, never a hardcoded date — same trap as
// tests/integration/helpers/testDates.ts documents for booking dates), so the
// routes' default date always matches the seeded day.

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("TZ", "UTC"); // vitest sets TZ=UTC usually but just to be sure

  await getPrisma().setting.create({
    data: {
      key: "workingHours",
      value: {
        sat: { open: "10:00", close: "17:00" },
        sun: { open: "10:00", close: "17:00" },
        mon: { open: "10:00", close: "17:00" },
        tue: { open: "10:00", close: "17:00" },
        wed: { open: "10:00", close: "17:00" },
        thu: { open: "10:00", close: "17:00" },
        fri: { closed: true }
      }
    }
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `sms-center-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active: true,
    },
  });
}

async function cookieFor(user: { id: string; role: Role }) {
  const token = await createSessionToken({
    userId: user.id,
    role: user.role as "ADMIN" | "RECEPTIONIST",
    tokenVersion: 0,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function postRequest(path: string, body: unknown, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "GET",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

async function createPatient(data: {
  firstName: string;
  lastName: string;
  phone: string;
  active?: boolean;
  messagingOptOut?: boolean;
}) {
  return getPrisma().patient.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      phoneE164: "+213" + data.phone.slice(1),
      firstNameNormalized: data.firstName.toLowerCase(),
      lastNameNormalized: data.lastName.toLowerCase(),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.messagingOptOut !== undefined
        ? { messagingOptOut: data.messagingOptOut }
        : {}),
    },
  });
}

async function createService(name: string = "Consultation") {
  return getPrisma().service.create({
    data: { name, slug: name.toLowerCase(), description: "Test", durationMinutes: 30, active: true },
  });
}

async function createAppointment(patientId: string, serviceId: string, startTime: Date, status: AppointmentStatus) {
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId,
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60000),
      status,
      source: AppointmentSource.ONLINE,
    },
  });
}

/**
 * The broadcast fixture day: the CLINIC-local today with five appointments —
 * pA (CONFIRMED, reachable), pB (CONFIRMED, opted out), pC (PENDING,
 * reachable), pD (CANCELLED), pE (CONFIRMED but inactive) — plus one extra
 * CONFIRMED appointment of pA on ANOTHER open day that must never leak into
 * today's audience. Expected split (splitAudience): recipients pA + pC
 * (recipientCount 2); excluded pB OPTED_OUT, pD CANCELLED, pE INACTIVE.
 */
async function seedBroadcastDay() {
  const today = toClinicLocalDateString(new Date());
  const service = await createService();

  const [pA, pB, pC, pD, pE] = await Promise.all([
    createPatient({ firstName: "Amine", lastName: "Belkacem", phone: "0550300101" }),
    createPatient({ firstName: "Nadia", lastName: "Hamdi", phone: "0550300102", messagingOptOut: true }),
    createPatient({ firstName: "Sofiane", lastName: "Merabet", phone: "0550300103" }),
    createPatient({ firstName: "Lila", lastName: "Cherif", phone: "0550300104" }),
    createPatient({ firstName: "Omar", lastName: "Ziani", phone: "0550300105", active: false }),
  ]);

  const apptA = await createAppointment(pA.id, service.id, localStart(today, "10:00"), AppointmentStatus.CONFIRMED);
  const apptB = await createAppointment(pB.id, service.id, localStart(today, "10:30"), AppointmentStatus.CONFIRMED);
  const apptC = await createAppointment(pC.id, service.id, localStart(today, "11:00"), AppointmentStatus.PENDING);
  const apptD = await createAppointment(pD.id, service.id, localStart(today, "11:30"), AppointmentStatus.CANCELLED);
  const apptE = await createAppointment(pE.id, service.id, localStart(today, "12:00"), AppointmentStatus.CONFIRMED);

  // pA's second appointment, days later on another open day: same patient,
  // but a different clinic-local date — the broadcast targets ONE day only.
  const otherDate = await nextOpenLocalDate(5);
  const otherAppt = await createAppointment(pA.id, service.id, localStart(otherDate, "10:00"), AppointmentStatus.CONFIRMED);

  return { today, service, pA, pB, pC, pD, pE, apptA, apptB, apptC, apptD, apptE, otherDate, otherAppt };
}

describe("POST /api/admin/sms/single", () => {
  it("ADMIN sends a manual SMS: row MANUAL/SENT with body verbatim + templateId null, and an SMS_SENT audit", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient({ firstName: "Yacine", lastName: "Mokrani", phone: "0550400101" });
    const { POST: singleRoute } = await import("@/app/api/admin/sms/single/route");

    const response = await singleRoute(
      postRequest("/api/admin/sms/single", { patientId: patient.id, body: "Bonjour, merci d'arriver 10 minutes en avance." }, cookie),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sent).toBe(true);
    expect(body.status).toBe(SmsStatus.SENT);
    // The body the sender typed is NEVER echoed back.
    expect(JSON.stringify(body)).not.toContain("arriver");

    const sms = await getPrisma().smsMessage.findUnique({ where: { id: body.messageId } });
    expect(sms).not.toBeNull();
    expect(sms!.type).toBe(SmsMessageType.MANUAL);
    expect(sms!.patientId).toBe(patient.id);
    expect(sms!.sentById).toBe(admin.id);
    expect(sms!.status).toBe(SmsStatus.SENT);
    expect(sms!.body).toBe("Bonjour, merci d'arriver 10 minutes en avance.");
    expect(sms!.templateId).toBeNull();

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.SMS_SENT, entityId: body.messageId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe(AuditActorType.STAFF);
    expect(audit!.userId).toBe(admin.id);
    expect(audit!.entityType).toBe("SmsMessage");
  });

  it("RECEPTIONIST may send too (200)", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Rania", lastName: "Toumi", phone: "0550400102" });
    const { POST: singleRoute } = await import("@/app/api/admin/sms/single/route");

    const response = await singleRoute(
      postRequest("/api/admin/sms/single", { patientId: patient.id, body: "Message de la réception." }, cookie),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sent).toBe(true);
    expect(await getPrisma().smsMessage.count()).toBe(1);
  });

  it("anonymized patient -> 404 and NO SmsMessage row", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient({ firstName: "Karim", lastName: "Aadi", phone: "0550400103" });
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { anonymizedAt: new Date() },
    });
    const { POST: singleRoute } = await import("@/app/api/admin/sms/single/route");

    const response = await singleRoute(
      postRequest("/api/admin/sms/single", { patientId: patient.id, body: "Ne doit jamais partir." }, cookie),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("empty body -> 400 VALIDATION_ERROR, no row", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient({ firstName: "Hakim", lastName: "Lounis", phone: "0550400104" });
    const { POST: singleRoute } = await import("@/app/api/admin/sms/single/route");

    const response = await singleRoute(
      postRequest("/api/admin/sms/single", { patientId: patient.id, body: "" }, cookie),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });
});

describe("POST /api/admin/sms/broadcast/preview", () => {
  it("returns today's audience with exact exclusion reasons + sample body, writing NOTHING", async () => {
    const seed = await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: previewRoute } = await import("@/app/api/admin/sms/broadcast/preview/route");

    const beforeMessages = await getPrisma().smsMessage.count();
    // No date passed: the route must default to the CLINIC-local today.
    const response = await previewRoute(
      postRequest("/api/admin/sms/broadcast/preview", { delayMinutes: 15 }, cookie),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.date).toBe(seed.today);
    expect(body.delayMinutes).toBe(15);
    expect(body.recipientCount).toBe(2);
    expect(body.recipients.map((r: { patientId: string }) => r.patientId).sort()).toEqual(
      [seed.pA.id, seed.pC.id].sort(),
    );
    expect(typeof body.recipients[0].startTime).toBe("string");
    expect(body.recipients[0].phone).toBe("+213550300101");

    expect(body.excluded).toHaveLength(3);
    const reasonByAppointment = new Map(
      body.excluded.map((e: { appointmentId: string; reason: string }) => [e.appointmentId, e.reason]),
    );
    expect(reasonByAppointment.get(seed.apptB.id)).toBe("OPTED_OUT");
    expect(reasonByAppointment.get(seed.apptD.id)).toBe("CANCELLED");
    expect(reasonByAppointment.get(seed.apptE.id)).toBe("INACTIVE");
    // pA's other-day appointment must not leak into today's audience.
    expect(reasonByAppointment.has(seed.otherAppt.id)).toBe(false);
    expect(body.recipients.some((r: { appointmentId: string }) => r.appointmentId === seed.otherAppt.id)).toBe(false);

    expect(body.sampleBody).toContain("retardé");

    // A preview is a pure read: no message, no batch row.
    expect(await getPrisma().smsMessage.count()).toBe(beforeMessages);
    expect(await getPrisma().smsBroadcast.count()).toBe(0);
  });
});

describe("POST /api/admin/sms/broadcast", () => {
  it("sends the delay broadcast: counters, DELAY rows sharing the batchId (no appointmentId), batch row + audit", async () => {
    const seed = await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    const response = await broadcastRoute(
      postRequest("/api/admin/sms/broadcast", { delayMinutes: 15, idempotencyKey: "send-key-0001" }, cookie),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadySent).toBe(false);
    // pB (opted out) and pE (inactive) are EXCLUDED by the audience split —
    // they never reach the dispatcher, so suppressedCount stays 0; only
    // dispatcher-null returns would count as suppressed.
    expect(body.sentCount).toBe(2);
    expect(body.suppressedCount).toBe(0);
    expect(body.failedCount).toBe(0);
    expect(body.recipientCount).toBe(2);

    const rows = await getPrisma().smsMessage.findMany({ where: { batchId: body.batchId } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBe(SmsMessageType.DELAY);
      // DELAY rows never carry an appointmentId: the (appointmentId, type)
      // unique index would otherwise block a second broadcast the same day.
      expect(row.appointmentId).toBeNull();
      expect(row.sentById).toBe(admin.id);
      expect(row.status).toBe(SmsStatus.SENT);
    }

    const batch = await getPrisma().smsBroadcast.findUnique({ where: { id: body.batchId } });
    expect(batch).not.toBeNull();
    expect(batch!.date).toBe(seed.today);
    expect(batch!.delayMinutes).toBe(15);
    expect(batch!.idempotencyKey).toBe("send-key-0001");
    expect(batch!.recipientCount).toBe(2);
    expect(batch!.sentCount).toBe(2);
    expect(batch!.suppressedCount).toBe(0);
    expect(batch!.failedCount).toBe(0);
    expect(batch!.sentById).toBe(admin.id);

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.SMS_SENT, entityType: "SmsBroadcast", entityId: body.batchId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(admin.id);
    const detail = (audit!.detail ?? {}) as Record<string, unknown>;
    expect(detail.recipientCount).toBe(2);
  });

  it("double-submit with the SAME idempotencyKey: same batchId, alreadySent true, ZERO extra rows", async () => {
    await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    const payload = { delayMinutes: 15, idempotencyKey: "double-key-001" };
    const first = await broadcastRoute(postRequest("/api/admin/sms/broadcast", payload, cookie));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.alreadySent).toBe(false);

    const delayCountAfterFirst = await getPrisma().smsMessage.count({
      where: { type: SmsMessageType.DELAY },
    });

    // The exact same POST (double click / retried request).
    const second = await broadcastRoute(postRequest("/api/admin/sms/broadcast", payload, cookie));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.alreadySent).toBe(true);
    expect(secondBody.batchId).toBe(firstBody.batchId);
    expect(secondBody.sentCount).toBe(firstBody.sentCount);

    expect(
      await getPrisma().smsMessage.count({ where: { type: SmsMessageType.DELAY } }),
    ).toBe(delayCountAfterFirst);
    expect(await getPrisma().smsBroadcast.count()).toBe(1);
  });

  it("resumes an INCOMPLETE batch with the same key instead of stranding the tail", async () => {
    const seed = await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    // Simulate a run that died mid-loop after the first of 2 recipients:
    // one DELAY row sent, batch counters showing 1 of 2 processed.
    const partial = await getPrisma().smsBroadcast.create({
      data: {
        date: seed.today,
        delayMinutes: 15,
        idempotencyKey: "resume-key-001",
        recipientCount: 2,
        sentCount: 1,
        suppressedCount: 0,
        failedCount: 0,
        sentById: admin.id,
      },
    });
    await getPrisma().smsMessage.create({
      data: {
        to: "+213550000001",
        body: "partial",
        type: SmsMessageType.DELAY,
        batchId: partial.id,
        provider: "mock",
        status: SmsStatus.SENT,
        sentById: admin.id,
      },
    });

    const retry = await broadcastRoute(
      postRequest(
        "/api/admin/sms/broadcast",
        { delayMinutes: 15, idempotencyKey: "resume-key-001" },
        cookie,
      ),
    );
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.batchId).toBe(partial.id);
    expect(body.alreadySent).toBe(false);
    // Only the remaining recipient was messaged: 1 old + 1 new row.
    expect(
      await getPrisma().smsMessage.count({
        where: { batchId: partial.id, type: SmsMessageType.DELAY },
      }),
    ).toBe(2);
    const batch = await getPrisma().smsBroadcast.findUnique({
      where: { id: partial.id },
    });
    expect(batch!.sentCount).toBe(2);
    expect(await getPrisma().smsBroadcast.count()).toBe(1);
  });

  it("a DIFFERENT idempotencyKey the same day is a new batch (2 more DELAY rows) — designed behavior", async () => {    await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    const first = await broadcastRoute(
      postRequest("/api/admin/sms/broadcast", { delayMinutes: 15, idempotencyKey: "first-key-0001" }, cookie),
    );
    const firstBody = await first.json();
    expect(firstBody.alreadySent).toBe(false);

    const second = await broadcastRoute(
      postRequest("/api/admin/sms/broadcast", { delayMinutes: 15, idempotencyKey: "second-key-002" }, cookie),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.alreadySent).toBe(false);
    expect(secondBody.batchId).not.toBe(firstBody.batchId);

    const secondBatchRows = await getPrisma().smsMessage.findMany({
      where: { batchId: secondBody.batchId },
    });
    expect(secondBatchRows).toHaveLength(2);
    expect(await getPrisma().smsBroadcast.count()).toBe(2);
    expect(await getPrisma().smsMessage.count({ where: { type: SmsMessageType.DELAY } })).toBe(4);
  });

  it("RECEPTIONIST is blocked from preview AND broadcast, zero rows created", async () => {
    await seedBroadcastDay();
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    const { POST: previewRoute } = await import("@/app/api/admin/sms/broadcast/preview/route");
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    const preview = await previewRoute(
      postRequest("/api/admin/sms/broadcast/preview", { delayMinutes: 15 }, cookie),
    );
    expect(preview.status).toBe(403);

    const broadcast = await broadcastRoute(
      postRequest("/api/admin/sms/broadcast", { delayMinutes: 15, idempotencyKey: "blocked-key-01" }, cookie),
    );
    expect(broadcast.status).toBe(403);

    expect(await getPrisma().smsMessage.count()).toBe(0);
    expect(await getPrisma().smsBroadcast.count()).toBe(0);
  });

  it("DELAY body carries the recipient's slot time and the delayMinutes", async () => {
    const seed = await seedBroadcastDay();
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const { POST: broadcastRoute } = await import("@/app/api/admin/sms/broadcast/route");

    const response = await broadcastRoute(
      postRequest("/api/admin/sms/broadcast", { delayMinutes: 15, idempotencyKey: "body-key-0001" }, cookie),
    );
    const body = await response.json();

    const rowForA = await getPrisma().smsMessage.findFirst({
      where: { batchId: body.batchId, patientId: seed.pA.id },
    });
    expect(rowForA).not.toBeNull();
    // The slot time is rendered clinic-local (the seeded 10:00 local start)
    // and the delay minutes appear verbatim.
    expect(rowForA!.body).toContain(formatClinicLocalTime(seed.apptA.startTime));
    expect(rowForA!.body).toContain("15");
  });
});

describe("GET /api/admin/sms (history)", () => {
  /** Seed an SmsMessage row directly — the history read does not need a real
   * send, only rows with controlled createdAt/batchId/type/patientId. */
  async function createSmsRow(data: {
    patientId?: string;
    batchId?: string;
    type?: SmsMessageType;
    body?: string;
    createdAt: Date;
  }) {
    return getPrisma().smsMessage.create({
      data: {
        to: "+213550300100",
        body: data.body ?? "Message de test.",
        ...(data.patientId ? { patientId: data.patientId } : {}),
        ...(data.batchId ? { batchId: data.batchId } : {}),
        type: data.type ?? SmsMessageType.MANUAL,
        provider: "mock",
        status: SmsStatus.SENT,
        sentAt: data.createdAt,
        createdAt: data.createdAt,
      },
    });
  }

  const t1 = new Date("2026-01-01T10:00:00Z");
  const t2 = new Date("2026-01-01T10:01:00Z");
  const t3 = new Date("2026-01-01T10:02:00Z");

  it("returns rows newest-first with the patient's name (and the body, this read may show it)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient({ firstName: "Sami", lastName: "Ghezali", phone: "0550400201" });
    const [r1, r2, r3] = await Promise.all([
      createSmsRow({ patientId: patient.id, createdAt: t1 }),
      createSmsRow({ patientId: patient.id, createdAt: t2 }),
      createSmsRow({ patientId: patient.id, createdAt: t3 }),
    ]);
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest("/api/admin/sms", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([r3.id, r2.id, r1.id]);
    expect(body.messages[0].patient).toEqual({
      id: patient.id,
      firstName: "Sami",
      lastName: "Ghezali",
    });
    expect(body.nextCursor).toBeNull();
  });

  it("filters by batchId", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const [inBatchA, inBatchB] = await Promise.all([
      createSmsRow({ batchId: "batch-hist-a", createdAt: t1 }),
      createSmsRow({ batchId: "batch-hist-a", createdAt: t2 }),
    ]);
    await createSmsRow({ batchId: "batch-hist-b", createdAt: t3 });
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest("/api/admin/sms?batchId=batch-hist-a", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([inBatchB.id, inBatchA.id]);
  });

  it("filters by patientId", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const p1 = await createPatient({ firstName: "Lina", lastName: "Brahimi", phone: "0550400202" });
    const p2 = await createPatient({ firstName: "Mehdi", lastName: "Saidi", phone: "0550400203" });
    const [own1, own2] = await Promise.all([
      createSmsRow({ patientId: p1.id, createdAt: t1 }),
      createSmsRow({ patientId: p1.id, createdAt: t2 }),
    ]);
    await createSmsRow({ patientId: p2.id, createdAt: t3 });
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest(`/api/admin/sms?patientId=${p1.id}`, cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([own2.id, own1.id]);
  });

  it("filters by type=DELAY", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const delay = await createSmsRow({ type: SmsMessageType.DELAY, batchId: "batch-hist-d", createdAt: t2 });
    await createSmsRow({ type: SmsMessageType.MANUAL, createdAt: t1 });
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest("/api/admin/sms?type=DELAY", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([delay.id]);
  });

  it("paginates: limit=2 returns the 2 newest + a cursor, and the cursor page returns only the remaining row", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const [r1, r2, r3] = await Promise.all([
      createSmsRow({ createdAt: t1 }),
      createSmsRow({ createdAt: t2 }),
      createSmsRow({ createdAt: t3 }),
    ]);
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const first = await historyRoute(getRequest("/api/admin/sms?limit=2", cookie));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.messages.map((m: { id: string }) => m.id)).toEqual([r3.id, r2.id]);
    expect(firstBody.nextCursor).toBe(r2.id);

    const second = await historyRoute(getRequest(`/api/admin/sms?limit=2&cursor=${r2.id}`, cookie));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    // Only the one remaining row, no overlap with page 1; the page is not
    // full so there is no further cursor.
    expect(secondBody.messages.map((m: { id: string }) => m.id)).toEqual([r1.id]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("audits the read: PATIENT_RECORD_VIEWED / SmsMessage with scope sms-history (ids/enums only, never the body)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const patient = await createPatient({ firstName: "Wassim", lastName: "Kaci", phone: "0550400204" });
    await createSmsRow({ patientId: patient.id, body: "Corps confidentiel.", createdAt: t1 });
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest("/api/admin/sms", cookie));
    expect(response.status).toBe(200);

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.PATIENT_RECORD_VIEWED, entityType: "SmsMessage" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe(AuditActorType.STAFF);
    expect(audit!.userId).toBe(admin.id);
    const detail = (audit!.detail ?? {}) as Record<string, unknown>;
    expect(detail.scope).toBe("sms-history");
    expect(detail.resultCount).toBe(1);
    expect(JSON.stringify(audit!.detail)).not.toContain("Corps confidentiel.");
  });

  it("RECEPTIONIST may read the history too (200)", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    await createSmsRow({ createdAt: t1 });
    const { GET: historyRoute } = await import("@/app/api/admin/sms/route");

    const response = await historyRoute(getRequest("/api/admin/sms", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
  });
});

describe("GET /api/admin/sms/batches", () => {
  it("returns both batches newest-first with counts and the sender's name", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);
    const earlier = new Date("2026-01-01T09:00:00Z");
    const later = new Date("2026-01-01T10:00:00Z");
    await getPrisma().smsBroadcast.create({
      data: {
        date: "2026-01-01",
        delayMinutes: 10,
        idempotencyKey: "hist-batch-0001",
        recipientCount: 3,
        sentCount: 2,
        suppressedCount: 1,
        failedCount: 0,
        sentById: admin.id,
        createdAt: earlier,
      },
    });
    const newest = await getPrisma().smsBroadcast.create({
      data: {
        date: "2026-01-01",
        delayMinutes: 20,
        idempotencyKey: "hist-batch-0002",
        recipientCount: 5,
        sentCount: 4,
        suppressedCount: 0,
        failedCount: 1,
        sentById: admin.id,
        createdAt: later,
      },
    });
    const { GET: batchesRoute } = await import("@/app/api/admin/sms/batches/route");

    const response = await batchesRoute(getRequest("/api/admin/sms/batches", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.batches).toHaveLength(2);
    expect(body.batches[0].id).toBe(newest.id);
    expect(body.batches[0].date).toBe("2026-01-01");
    expect(body.batches[0].delayMinutes).toBe(20);
    expect(body.batches[0].recipientCount).toBe(5);
    expect(body.batches[0].sentCount).toBe(4);
    expect(body.batches[0].suppressedCount).toBe(0);
    expect(body.batches[0].failedCount).toBe(1);
    expect(body.batches[0].sentBy).toEqual({ name: "Staff Test" });
    // The older batch comes second.
    expect(body.batches[1].delayMinutes).toBe(10);
  });

  it("RECEPTIONIST may list the batches too (200)", async () => {
    const staff = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(staff);
    await getPrisma().smsBroadcast.create({
      data: {
        date: "2026-01-01",
        delayMinutes: 15,
        idempotencyKey: "hist-batch-0003",
        recipientCount: 1,
        sentCount: 1,
      },
    });
    const { GET: batchesRoute } = await import("@/app/api/admin/sms/batches/route");

    const response = await batchesRoute(getRequest("/api/admin/sms/batches", cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.batches).toHaveLength(1);
  });
});
