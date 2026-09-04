import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentSource,
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
  NotificationType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { sendReminders } from "@/lib/cron/reminders";
import { markNoShows } from "@/lib/cron/noShow";
import { expirePendingBookings } from "@/lib/cron/expirePending";
import { onSlotFreed, type SlotFreedEvent } from "@/lib/booking/events";
import { GET as remindersRoute } from "@/app/api/cron/reminders/route";
import { GET as noShowFollowupRoute } from "@/app/api/cron/no-show-followup/route";
import { GET as expirePendingRoute } from "@/app/api/cron/expire-pending/route";
import { GET as healthRoute } from "@/app/api/health/route";

// Task 9: reminders + no-show follow-up + PENDING expiry cron jobs.
//
// Every cron job must be safe to run twice (idempotency guards:
// `reminderSentAt` + the `(appointmentId, type)` unique index for reminders,
// and the active-status transition guards for no-show/expiry), and every
// action must be audited with actor SYSTEM.

const SECRET = "test-cron-secret";

// Fixed "now" so window arithmetic is deterministic.
const NOW = new Date("2026-08-28T10:00:00.000Z");

let serviceId: string;
let activeStaffIds: string[];

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  const prisma = getPrisma();

  const service = await prisma.service.create({
    data: {
      slug: "cron-test-service",
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
        email: "cron-staff-a@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    }),
    prisma.user.create({
      data: {
        name: "Staff B",
        email: "cron-staff-b@orthocare.com",
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

type AppointmentOverrides = {
  status?: AppointmentStatus;
  startTime?: Date;
  endTime?: Date;
  createdAt?: Date;
};

async function makeAppointment(patientId: string, overrides: AppointmentOverrides = {}) {
  const startTime =
    overrides.startTime ?? new Date(NOW.getTime() + 6 * 3600_000);
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId,
      startTime,
      endTime: overrides.endTime ?? new Date(startTime.getTime() + 30 * 60_000),
      status: overrides.status ?? AppointmentStatus.CONFIRMED,
      // Default: created an hour ago — inside the expiry window.
      createdAt: overrides.createdAt ?? new Date(NOW.getTime() - 3600_000),
    },
  });
}

function cronRequest(path: string, secret?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: secret ? { "x-cron-secret": secret } : {},
  });
}

function cronRequestBearer(path: string, secret?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("cron route auth (CRON_SECRET)", () => {
  it("rejects every cron route without the CRON_SECRET header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const routes = [
      () => remindersRoute(cronRequest("/api/cron/reminders")),
      () => noShowFollowupRoute(cronRequest("/api/cron/no-show-followup")),
      () => expirePendingRoute(cronRequest("/api/cron/expire-pending")),
    ];
    for (const call of routes) {
      const res = await call();
      expect(res.status).toBe(401);
    }
  });

  it("rejects every cron route when the header does not match", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const routes = [
      () => remindersRoute(cronRequest("/api/cron/reminders", "wrong")),
      () => noShowFollowupRoute(cronRequest("/api/cron/no-show-followup", "wrong")),
      () => expirePendingRoute(cronRequest("/api/cron/expire-pending", "wrong")),
    ];
    for (const call of routes) {
      const res = await call();
      expect(res.status).toBe(401);
    }
  });

  it("rejects a malformed Authorization header (missing Bearer prefix)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const req = new NextRequest("http://localhost/api/cron/reminders", {
      headers: { authorization: SECRET }, // no "Bearer " prefix
    });
    const res = await remindersRoute(req);
    expect(res.status).toBe(401);
  });

  it("accepts the Vercel-native Authorization: Bearer header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await remindersRoute(
      cronRequestBearer("/api/cron/reminders", SECRET),
    );
    expect(res.status).toBe(200);
  });

  it("rejects cron routes when CRON_SECRET is not configured at all", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await remindersRoute(
      cronRequest("/api/cron/reminders", SECRET),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the reminders route with a matching header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const patient = await makePatient();
    // The route runs against the real clock, so seed inside its 24h window.
    await makeAppointment(patient.id, {
      startTime: new Date(Date.now() + 6 * 3600_000),
    });

    const res = await remindersRoute(
      cronRequest("/api/cron/reminders", SECRET),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sent: 1 });
  });
});

describe("sendReminders", () => {
  it("sends a 24h-before reminder to CONFIRMED appointments, sets reminderSentAt and audits with SYSTEM", async () => {
    const patient = await makePatient();
    const inWindow = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 6 * 3600_000),
    });

    const sent = await sendReminders(NOW);

    expect(sent).toBe(1);

    const msg = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: inWindow.id, type: SmsMessageType.REMINDER },
    });
    expect(msg).not.toBeNull();
    expect(msg!.to).toBe("+213551122334");
    expect(msg!.status).toBe(SmsStatus.SENT);
    expect(msg!.provider).toBe("mock");
    expect(msg!.body.toLowerCase()).toContain("rappel");

    const updated = await getPrisma().appointment.findUnique({
      where: { id: inWindow.id },
    });
    expect(updated!.reminderSentAt).toBeInstanceOf(Date);

    const audit = await getPrisma().auditLog.findMany({
      where: { action: AuditAction.SMS_SENT },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorType).toBe(AuditActorType.SYSTEM);
    expect(audit[0].entityType).toBe("Appointment");
    expect(audit[0].entityId).toBe(inWindow.id);
  });

  it("skips CONFIRMED appointments outside the 24h window and any PENDING appointment", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 30 * 3600_000), // beyond 24h
    });
    await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      startTime: new Date(NOW.getTime() + 6 * 3600_000),
    });

    const sent = await sendReminders(NOW);

    expect(sent).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("is idempotent: running twice sends exactly one reminder", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 6 * 3600_000),
    });

    await sendReminders(NOW);
    const second = await sendReminders(NOW);

    expect(second).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(1);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.REMINDER, status: SmsStatus.SENT },
      }),
    ).toBe(1);
  });

  it("does not remind an appointment cancelled before the run", async () => {
    const patient = await makePatient();
    const cancelled = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 6 * 3600_000),
    });
    await getPrisma().appointment.update({
      where: { id: cancelled.id },
      data: { status: AppointmentStatus.CANCELLED },
    });

    const sent = await sendReminders(NOW);

    expect(sent).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("does not set reminderSentAt when the provider fails, and retries on the next run", async () => {
    vi.stubEnv("MESSAGE_PROVIDER", "twilio"); // stub always FAILS
    const patient = await makePatient();
    const inWindow = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 6 * 3600_000),
    });

    const first = await sendReminders(NOW);
    expect(first).toBe(0);

    const msg = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: inWindow.id, type: SmsMessageType.REMINDER },
    });
    expect(msg!.status).toBe(SmsStatus.FAILED);

    const updated = await getPrisma().appointment.findUnique({
      where: { id: inWindow.id },
    });
    expect(updated!.reminderSentAt).toBeNull();

    // Next run with a healthy provider re-attempts the SAME row.
    vi.unstubAllEnvs();
    const second = await sendReminders(NOW);
    expect(second).toBe(1);

    const retried = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: inWindow.id, type: SmsMessageType.REMINDER },
    });
    expect(retried!.id).toBe(msg!.id);
    expect(retried!.status).toBe(SmsStatus.SENT);
    expect(
      await getPrisma().smsMessage.count({
        where: { appointmentId: inWindow.id, type: SmsMessageType.REMINDER },
      }),
    ).toBe(1);
  });
});

describe("markNoShows", () => {
  it("marks a past CONFIRMED appointment NO_SHOW, sets noShowAt, sends the follow-up and notifies staff", async () => {
    const patient = await makePatient();
    const past = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 13 * 3600_000),
    });

    const marked = await markNoShows(NOW);

    expect(marked).toBe(1);

    const updated = await getPrisma().appointment.findUnique({
      where: { id: past.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.NO_SHOW);
    expect(updated!.noShowAt).toBeInstanceOf(Date);

    const msg = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: past.id, type: SmsMessageType.NO_SHOW },
    });
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe(SmsStatus.SENT);

    const notifications = await getPrisma().notification.findMany({
      where: { type: NotificationType.NO_SHOW_ALERT },
    });
    expect(notifications).toHaveLength(activeStaffIds.length);
    for (const n of notifications) {
      expect(activeStaffIds).toContain(n.userId);
    }

    const audit = await getPrisma().auditLog.findMany({
      where: { action: AuditAction.APPOINTMENT_NO_SHOW },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorType).toBe(AuditActorType.SYSTEM);
    expect(audit[0].entityId).toBe(past.id);
  });

  it("leaves future CONFIRMED, PENDING, CANCELLED and COMPLETED appointments alone", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() + 2 * 3600_000), // future
    });
    await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 150 * 60_000),
    });
    await makeAppointment(patient.id, {
      status: AppointmentStatus.CANCELLED,
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 150 * 60_000),
    });
    await makeAppointment(patient.id, {
      status: AppointmentStatus.COMPLETED,
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 150 * 60_000),
    });

    const marked = await markNoShows(NOW);

    expect(marked).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("is idempotent: a second run marks nothing and sends nothing", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 13 * 3600_000),
    });

    await markNoShows(NOW);
    const second = await markNoShows(NOW);

    expect(second).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(1);
  });

  it("leaves same-day CONFIRMED appointments alone (12h grace for desk close-out)", async () => {
    const patient = await makePatient();
    const recent = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 2 * 3600_000),
    });

    const marked = await markNoShows(NOW);

    // The appointment ended 2h ago — inside the grace window, so a forgotten
    // same-day COMPLETED marking is not rewritten and no SMS goes out.
    expect(marked).toBe(0);
    const updated = await getPrisma().appointment.findUnique({
      where: { id: recent.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("still marks the no-show but suppresses the SMS for opted-out patients", async () => {    const patient = await makePatient({ messagingOptOut: true });
    const past = await makeAppointment(patient.id, {
      startTime: new Date(NOW.getTime() - 3 * 3600_000),
      endTime: new Date(NOW.getTime() - 13 * 3600_000),
    });

    const marked = await markNoShows(NOW);

    expect(marked).toBe(1);
    const updated = await getPrisma().appointment.findUnique({
      where: { id: past.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.NO_SHOW);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.NO_SHOW },
      }),
    ).toBe(0);
  });
});

describe("expirePendingBookings", () => {
  it("cancels a stale PENDING booking via releaseSlot with AUTO_EXPIRED, notifies the patient and creates a staff notification", async () => {
    const patient = await makePatient();
    const stale = await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 25 * 3600_000), // past 24h expiry
      startTime: new Date(NOW.getTime() + 2 * 3600_000),
    });

    const expired = await expirePendingBookings(NOW);

    expect(expired).toBe(1);

    const updated = await getPrisma().appointment.findUnique({
      where: { id: stale.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.CANCELLED);
    expect(updated!.cancelReason).toBe(CancelReason.AUTO_EXPIRED);
    expect(updated!.cancelledAt).toBeInstanceOf(Date);

    const msg = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: stale.id, type: SmsMessageType.EXPIRED },
    });
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe(SmsStatus.SENT);

    const notifications = await getPrisma().notification.findMany({
      where: { type: NotificationType.PENDING_EXPIRED },
    });
    expect(notifications).toHaveLength(activeStaffIds.length);
    for (const n of notifications) {
      expect(activeStaffIds).toContain(n.userId);
    }

    const audit = await getPrisma().auditLog.findMany({
      where: { action: AuditAction.APPOINTMENT_AUTO_CANCELLED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorType).toBe(AuditActorType.SYSTEM);
    expect(audit[0].entityId).toBe(stale.id);
  });

  it("goes through releaseSlot, so a slot-freed event fires with the service", async () => {
    const patient = await makePatient();
    const stale = await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 25 * 3600_000),
      startTime: new Date(NOW.getTime() + 2 * 3600_000),
    });

    const events: SlotFreedEvent[] = [];
    const unsubscribe = onSlotFreed((e) => {
      events.push(e);
    });
    try {
      await expirePendingBookings(NOW);
    } finally {
      unsubscribe();
    }

    expect(events).toHaveLength(1);
    expect(events[0].appointmentId).toBe(stale.id);
    expect(events[0].serviceId).toBe(serviceId);
  });

  it("expires a PENDING booking whose start time has passed even within the expiry window", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 1 * 3600_000), // fresh
      startTime: new Date(NOW.getTime() - 30 * 60_000), // but already started
    });

    const expired = await expirePendingBookings(NOW);

    expect(expired).toBe(1);
    const pending = await getPrisma().appointment.findMany({
      where: { status: AppointmentStatus.PENDING },
    });
    expect(pending).toHaveLength(0);
  });

  it("leaves fresh PENDING bookings with a future start time alone", async () => {
    const patient = await makePatient();
    const fresh = await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 1 * 3600_000),
      startTime: new Date(NOW.getTime() + 2 * 24 * 3600_000),
    });

    const expired = await expirePendingBookings(NOW);

    expect(expired).toBe(0);
    const updated = await getPrisma().appointment.findUnique({
      where: { id: fresh.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.PENDING);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("does not touch CONFIRMED bookings", async () => {
    const patient = await makePatient();
    const confirmed = await makeAppointment(patient.id, {
      status: AppointmentStatus.CONFIRMED,
      createdAt: new Date(NOW.getTime() - 25 * 3600_000),
      startTime: new Date(NOW.getTime() - 2 * 3600_000),
    });

    const expired = await expirePendingBookings(NOW);

    expect(expired).toBe(0);
    const updated = await getPrisma().appointment.findUnique({
      where: { id: confirmed.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("does not auto-expire MANUAL PENDING bookings (a staff decision, not the cron's)", async () => {
    const patient = await makePatient();
    const manual = await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId,
        status: AppointmentStatus.PENDING,
        source: AppointmentSource.MANUAL,
        createdAt: new Date(NOW.getTime() - 25 * 3600_000), // stale by time
        startTime: new Date(NOW.getTime() + 2 * 3600_000),
        endTime: new Date(NOW.getTime() + 150 * 60_000),
      },
    });

    const expired = await expirePendingBookings(NOW);

    expect(expired).toBe(0);
    const updated = await getPrisma().appointment.findUnique({
      where: { id: manual.id },
    });
    expect(updated!.status).toBe(AppointmentStatus.PENDING);
    expect(await getPrisma().smsMessage.count()).toBe(0);
  });

  it("is idempotent: a second run expires nothing and sends nothing", async () => {
    const patient = await makePatient();
    await makeAppointment(patient.id, {
      status: AppointmentStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 25 * 3600_000),
      startTime: new Date(NOW.getTime() + 2 * 3600_000),
    });

    await expirePendingBookings(NOW);
    const second = await expirePendingBookings(NOW);

    expect(second).toBe(0);
    expect(await getPrisma().smsMessage.count()).toBe(1);
  });
});

describe("GET /api/health", () => {
  it("returns 200 ok without any auth", async () => {
    const res = await healthRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });
});