import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role, AppointmentStatus, AppointmentSource, CancelReason } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { futureBookableLocalStart, nextOpenLocalDate } from "./helpers/testDates";
import { getClinicDayBoundsUTC, addClinicDays } from "@/lib/time/clinicTime";

// Senders from MESSAGE_PROVIDER default mock
// The messaging framework logs its intercepted messages to SmsMessage rows
// We can assert those rows are created.

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
      email: `appointments-api-${Math.random().toString(36).slice(2)}@test.com`,
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

function getRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function postRequest(path: string, body: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patchRequest(path: string, body: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function lastAudit(action: AuditAction) {
  return getPrisma().auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: "desc" },
  });
}

async function createPatient(data: { firstName: string; lastName: string; phone: string; active?: boolean }) {
  return getPrisma().patient.create({
    data: {
      ...data,
      phoneE164: "+213" + data.phone.slice(1),
      firstNameNormalized: data.firstName.toLowerCase(),
      lastNameNormalized: data.lastName.toLowerCase(),
    },
  });
}

async function createService(name: string = "Consultation", durationMinutes: number = 30) {
  return getPrisma().service.create({
    data: { name, slug: name.toLowerCase(), description: "Test", durationMinutes, active: true },
  });
}

describe("GET /api/admin/appointments", () => {
  it("returns day view and audits PATIENT_RECORD_VIEWED with date and resultCount but no PII", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Ali", lastName: "Ahmed", phone: "0550111222" });
    const service = await createService();
    
    const localDate = await nextOpenLocalDate(2);
    const startUTC = await futureBookableLocalStart("11:00", 2);
    const endUTC = new Date(startUTC.getTime() + 30 * 60000);
    
    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: startUTC,
        endTime: endUTC,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ONLINE,
      }
    });

    const { GET: appointmentsListRoute } = await import("@/app/api/admin/appointments/route");
    
    const response = await appointmentsListRoute(getRequest(`/api/admin/appointments?date=${localDate}`, cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    
    expect(body.date).toBe(localDate);
    expect(body.appointments.length).toBe(1);
    expect(body.appointments[0].patient.firstName).toBe("Ali");

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.userId).toBe(staff.id);
    const detail = audit?.detail as any;
    expect(detail.scope).toBe("day-view");
    expect(detail.date).toBe(localDate);
    expect(detail.resultCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("Ali");
  });

  it("returns [] for a date with no appointments", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const { GET: appointmentsListRoute } = await import("@/app/api/admin/appointments/route");
    
    const localDate = await nextOpenLocalDate(2);
    const response = await appointmentsListRoute(getRequest(`/api/admin/appointments?date=${localDate}`, cookie));
    const body = await response.json();
    expect(body.appointments).toEqual([]);
  });
});

describe("POST /api/admin/appointments", () => {
  it("creates a manual booking (CONFIRMED), blocks the slot, and audits APPOINTMENT_CONFIRMED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Sara", lastName: "Ben", phone: "0550111333" });
    const service = await createService();
    const startUTC = await futureBookableLocalStart("11:00");

    const { POST: appointmentsCreateRoute } = await import("@/app/api/admin/appointments/route");

    const response = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: patient.id,
      serviceId: service.id,
      startTime: startUTC.toISOString(),
      notes: "Urgent",
      locale: "fr"
    }, cookie));
    
    expect(response.status).toBe(201);
    const body = await response.json();
    
    const dbAppt = await getPrisma().appointment.findUnique({ where: { id: body.id } });
    expect(dbAppt?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(dbAppt?.createdByUserId).toBe(staff.id);
    expect(dbAppt?.visitNotes).toBe("Urgent");
    
    // Patient's preferredLocale should be updated
    const dbPatient = await getPrisma().patient.findUnique({ where: { id: patient.id } });
    expect(dbPatient?.preferredLocale).toBe("fr");

    // Second booking at the same time fails with SlotConflict
    const response2 = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: patient.id,
      serviceId: service.id,
      startTime: startUTC.toISOString()
    }, cookie));
    expect(response2.status).toBe(409);
    expect((await response2.json()).error.code).toBe("SLOT_CONFLICT");

    const audit = await lastAudit(AuditAction.APPOINTMENT_CONFIRMED);
    expect(audit?.userId).toBe(staff.id);
    const detail = audit?.detail as any;
    expect(detail.scope).toBe("manual-booking");
    expect(JSON.stringify(detail)).not.toContain("Sara");
  });

  it("returns 404 for an unknown patient", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const service = await createService();
    const startUTC = await futureBookableLocalStart("10:30");
    const { POST: appointmentsCreateRoute } = await import("@/app/api/admin/appointments/route");

    const response = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: "does-not-exist",
      serviceId: service.id,
      startTime: startUTC.toISOString()
    }, cookie));
    expect(response.status).toBe(404);
  });

  it("returns 400 when resourceId is provided", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Sara", lastName: "Ben", phone: "0550111333" });
    const service = await createService();
    const startUTC = await futureBookableLocalStart("11:00");
    const { POST: appointmentsCreateRoute } = await import("@/app/api/admin/appointments/route");

    const response = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: patient.id,
      serviceId: service.id,
      startTime: startUTC.toISOString(),
      resourceId: "some-chair"
    }, cookie));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("RESOURCE_UNSUPPORTED");
  });
});

describe("PATCH /api/admin/appointments/[id]", () => {
  async function createTestAppt(status: AppointmentStatus) {
    const patient = await createPatient({ firstName: "Test", lastName: "Appt", phone: "0550999888" });
    const service = await createService();
    const startUTC = await futureBookableLocalStart("14:00", 3);
    return getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: startUTC,
        endTime: new Date(startUTC.getTime() + 30 * 60000),
        status,
        source: AppointmentSource.ONLINE,
      }
    });
  }

  it("CONFIRM on PENDING -> CONFIRMED, sets confirmedAt, audits APPOINTMENT_CONFIRMED, writes SmsMessage", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.PENDING);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");

    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "CONFIRM" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);

    const dbAppt = await getPrisma().appointment.findUnique({ where: { id: appt.id } });
    expect(dbAppt?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(dbAppt?.confirmedAt).not.toBeNull();
    expect(dbAppt?.confirmedByUserId).toBe(staff.id);

    const audit = await lastAudit(AuditAction.APPOINTMENT_CONFIRMED);
    expect(audit?.entityId).toBe(appt.id);
    expect((audit?.detail as any).action).toBe("CONFIRM");

    // Message is written to SmsMessage
    const sms = await getPrisma().smsMessage.findFirst({ where: { appointmentId: appt.id } });
    expect(sms).not.toBeNull();
    expect(sms?.body).toContain("confirm"); // A naive check, the mock provider just renders the content
  });

  it("CANCEL on CONFIRMED -> CANCELLED, releases slot, CANCELLED SMS, APPOINTMENT_CANCELLED audit", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.CONFIRMED);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");
    const { POST: appointmentsCreateRoute } = await import("@/app/api/admin/appointments/route");

    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "CANCEL" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);
    const dbAppt = await getPrisma().appointment.findUnique({ where: { id: appt.id } });
    expect(dbAppt?.status).toBe(AppointmentStatus.CANCELLED);
    expect(dbAppt?.cancelledAt).not.toBeNull();
    expect(dbAppt?.cancelReason).toBe(CancelReason.STAFF);
    
    // Prove slot is freed: we can book again in this exact slot
    const response2 = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: appt.patientId,
      serviceId: appt.serviceId,
      startTime: appt.startTime.toISOString()
    }, cookie));
    expect(response2.status).toBe(201); // Created!

    const audit = await lastAudit(AuditAction.APPOINTMENT_CANCELLED);
    expect(audit?.entityId).toBe(appt.id);

    const sms = await getPrisma().smsMessage.findFirst({ where: { appointmentId: appt.id, type: "CANCELLED" } });
    expect(sms).not.toBeNull();
  });

  it("COMPLETE on CONFIRMED -> COMPLETED, audits, no SMS", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.CONFIRMED);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");

    const beforeSmsCount = await getPrisma().smsMessage.count();
    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "COMPLETE" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);

    const dbAppt = await getPrisma().appointment.findUnique({ where: { id: appt.id } });
    expect(dbAppt?.status).toBe(AppointmentStatus.COMPLETED);
    expect(dbAppt?.completedAt).not.toBeNull();

    const audit = await lastAudit(AuditAction.APPOINTMENT_COMPLETED);
    expect(audit?.entityId).toBe(appt.id);

    expect(await getPrisma().smsMessage.count()).toBe(beforeSmsCount);
  });

  it("NO_SHOW on CONFIRMED -> NO_SHOW, audits, no SMS", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.CONFIRMED);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");

    const beforeSmsCount = await getPrisma().smsMessage.count();
    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "NO_SHOW" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);

    const dbAppt = await getPrisma().appointment.findUnique({ where: { id: appt.id } });
    expect(dbAppt?.status).toBe(AppointmentStatus.NO_SHOW);
    expect(dbAppt?.noShowAt).not.toBeNull();

    const audit = await lastAudit(AuditAction.APPOINTMENT_NO_SHOW);
    expect(audit?.entityId).toBe(appt.id);

    expect(await getPrisma().smsMessage.count()).toBe(beforeSmsCount);
  });

  it("409 on invalid transitions (COMPLETE on PENDING)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.PENDING);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");

    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "COMPLETE" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("idempotent CONFIRM on already-CONFIRMED, no second SMS, audits PATIENT_RECORD_VIEWED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const appt = await createTestAppt(AppointmentStatus.CONFIRMED);
    const { PATCH: appointmentPatchRoute } = await import("@/app/api/admin/appointments/[id]/route");

    const beforeSmsCount = await getPrisma().smsMessage.count();
    const response = await appointmentPatchRoute(patchRequest(`/api/admin/appointments/${appt.id}`, { action: "CONFIRM" }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.entityId).toBe(appt.id);
    expect((audit?.detail as any).idempotentConfirm).toBe(true);

    expect(await getPrisma().smsMessage.count()).toBe(beforeSmsCount);
  });
});

describe("POST /api/admin/appointments/[id]/reschedule", () => {
  it("moves appointment, old RESCHEDULED, new CONFIRMED, slot freed/blocked, audits APPOINTMENT_RESCHEDULED, writes SMS", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Moha", lastName: "Med", phone: "0550123123" });
    const service = await createService();
    const oldStartUTC = await futureBookableLocalStart("14:30", 3);
    const newStartUTC = await futureBookableLocalStart("15:00", 4);

    const appt = await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: oldStartUTC,
        endTime: new Date(oldStartUTC.getTime() + 30 * 60000),
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.ONLINE,
      }
    });

    const { POST: appointmentRescheduleRoute } = await import("@/app/api/admin/appointments/[id]/reschedule/route");
    const { POST: appointmentsCreateRoute } = await import("@/app/api/admin/appointments/route");

    const response = await appointmentRescheduleRoute(postRequest(`/api/admin/appointments/${appt.id}/reschedule`, {
      startTime: newStartUTC.toISOString()
    }, cookie), { params: Promise.resolve({ id: appt.id }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.oldAppointment.status).toBe(AppointmentStatus.RESCHEDULED);
    expect(body.newAppointment.status).toBe(AppointmentStatus.CONFIRMED);

    const oldAppt = await getPrisma().appointment.findUnique({ where: { id: appt.id } });
    expect(oldAppt?.status).toBe(AppointmentStatus.RESCHEDULED);
    expect(oldAppt?.cancelReason).toBe(CancelReason.STAFF);

    const newAppt = await getPrisma().appointment.findUnique({ where: { id: body.newAppointment.id } });
    expect(newAppt).not.toBeNull();
    expect(newAppt?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(newAppt?.patientId).toBe(patient.id);
    expect(newAppt?.serviceId).toBe(service.id);
    expect(newAppt?.startTime.toISOString()).toBe(newStartUTC.toISOString());

    // Old slot is freed, can book again
    const response2 = await appointmentsCreateRoute(postRequest("/api/admin/appointments", {
      patientId: patient.id,
      serviceId: service.id,
      startTime: oldStartUTC.toISOString()
    }, cookie));
    expect(response2.status).toBe(201);

    const audit = await lastAudit(AuditAction.APPOINTMENT_RESCHEDULED);
    expect(audit?.entityId).toBe(appt.id);
    expect((audit?.detail as any).newAppointmentId).toBe(body.newAppointment.id);

    const sms = await getPrisma().smsMessage.findFirst({ where: { type: "RESCHEDULE", patientId: patient.id } });
    expect(sms).not.toBeNull();
  });

  it("409 SLOT_CONFLICT when new slot is taken", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Zaki", lastName: "Bou", phone: "0550123124" });
    const service = await createService();
    const start1 = await futureBookableLocalStart("14:30", 5);
    const start2 = await futureBookableLocalStart("15:00", 5);

    const appt1 = await getPrisma().appointment.create({
      data: { patientId: patient.id, serviceId: service.id, startTime: start1, endTime: new Date(start1.getTime() + 30 * 60000), status: AppointmentStatus.CONFIRMED, source: AppointmentSource.ONLINE }
    });
    // taken slot
    await getPrisma().appointment.create({
      data: { patientId: patient.id, serviceId: service.id, startTime: start2, endTime: new Date(start2.getTime() + 30 * 60000), status: AppointmentStatus.CONFIRMED, source: AppointmentSource.ONLINE }
    });

    const { POST: appointmentRescheduleRoute } = await import("@/app/api/admin/appointments/[id]/reschedule/route");
    const response = await appointmentRescheduleRoute(postRequest(`/api/admin/appointments/${appt1.id}/reschedule`, {
      startTime: start2.toISOString()
    }, cookie), { params: Promise.resolve({ id: appt1.id }) });
    
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("SLOT_CONFLICT");
  });

  it("404 on nonexistent id", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const newStartUTC = await futureBookableLocalStart("15:00", 6);
    const { POST: appointmentRescheduleRoute } = await import("@/app/api/admin/appointments/[id]/reschedule/route");

    const response = await appointmentRescheduleRoute(postRequest(`/api/admin/appointments/does-not-exist/reschedule`, {
      startTime: newStartUTC.toISOString()
    }, cookie), { params: Promise.resolve({ id: "does-not-exist" }) });
    
    expect(response.status).toBe(404);
  });
});

describe("GET /api/admin/appointments/pending", () => {
  it("returns PENDING oldest-first with msRemaining and expiresAt, audits PATIENT_RECORD_VIEWED", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient({ firstName: "Pend", lastName: "Ing", phone: "0550123125" });
    const service = await createService();
    const startUTC = await futureBookableLocalStart("16:00", 7);

    // older
    const appt1 = await getPrisma().appointment.create({
      data: { patientId: patient.id, serviceId: service.id, startTime: startUTC, endTime: new Date(startUTC.getTime() + 30 * 60000), status: AppointmentStatus.PENDING, source: AppointmentSource.ONLINE, createdAt: new Date(Date.now() - 3600000) }
    });
    // newer
    const appt2 = await getPrisma().appointment.create({
      data: { patientId: patient.id, serviceId: service.id, startTime: new Date(startUTC.getTime() + 30 * 60000), endTime: new Date(startUTC.getTime() + 60 * 60000), status: AppointmentStatus.PENDING, source: AppointmentSource.ONLINE, createdAt: new Date() }
    });
    // confirmed
    await getPrisma().appointment.create({
      data: { patientId: patient.id, serviceId: service.id, startTime: new Date(startUTC.getTime() + 90 * 60000), endTime: new Date(startUTC.getTime() + 120 * 60000), status: AppointmentStatus.CONFIRMED, source: AppointmentSource.ONLINE }
    });

    const { GET: appointmentsPendingRoute } = await import("@/app/api/admin/appointments/pending/route");
    const response = await appointmentsPendingRoute(getRequest("/api/admin/appointments/pending", cookie));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.appointments.length).toBe(2);
    expect(body.appointments[0].id).toBe(appt1.id);
    expect(body.appointments[1].id).toBe(appt2.id);

    expect(typeof body.appointments[0].msRemaining).toBe("number");
    expect(typeof body.appointments[0].expiresAt).toBe("string");

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect(audit?.userId).toBe(staff.id);
    expect((audit?.detail as any).scope).toBe("call-queue");
  });
});

describe("GET /api/admin/appointments/search", () => {
  it("finds by patient phone/name, partial digits, q NEVER in audit, LIKE metacharacters returns []", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient1 = await createPatient({ firstName: "Riad", lastName: "Mahrez", phone: "0550123789" });
    const service = await createService();
    const startUTC = await futureBookableLocalStart("11:00", 8);

    const appt = await getPrisma().appointment.create({
      data: { patientId: patient1.id, serviceId: service.id, startTime: startUTC, endTime: new Date(startUTC.getTime() + 30 * 60000), status: AppointmentStatus.CONFIRMED, source: AppointmentSource.ONLINE }
    });

    const { GET: appointmentsSearchRoute } = await import("@/app/api/admin/appointments/search/route");
    
    // by name
    const res1 = await appointmentsSearchRoute(getRequest("/api/admin/appointments/search?q=Mahrez", cookie));
    const b1 = await res1.json();
    expect(b1.appointments.length).toBe(1);
    expect(b1.appointments[0].id).toBe(appt.id);

    // case-insensitive name search
    const res1b = await appointmentsSearchRoute(getRequest("/api/admin/appointments/search?q=mAHrez", cookie));
    const b1b = await res1b.json();
    expect(b1b.appointments.length).toBe(1);
    expect(b1b.appointments[0].id).toBe(appt.id);

    // by partial digits
    const res2 = await appointmentsSearchRoute(getRequest("/api/admin/appointments/search?q=12378", cookie));
    const b2 = await res2.json();
    expect(b2.appointments.length).toBe(1);
    expect(b2.appointments[0].id).toBe(appt.id);

    // DZ phone format normalization
    const res2b = await appointmentsSearchRoute(getRequest("/api/admin/appointments/search?q=0550123789", cookie));
    const b2b = await res2b.json();
    expect(b2b.appointments.length).toBe(1);
    expect(b2b.appointments[0].id).toBe(appt.id);

    // LIKE metacharacters
    const res3 = await appointmentsSearchRoute(getRequest("/api/admin/appointments/search?q=%", cookie));
    const b3 = await res3.json();
    expect(b3.appointments).toEqual([]);

    const audit = await lastAudit(AuditAction.PATIENT_RECORD_VIEWED);
    expect((audit?.detail as any).scope).toBe("search");
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("Mahrez");
    expect(serialized).not.toContain("12378");
  });
});
