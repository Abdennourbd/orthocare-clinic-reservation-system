import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AuditAction,
  AuditActorType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

// Task 16 — integration tests for the first SMS Center route:
// POST /api/admin/sms/single. Setup mirrors appointments-api.test.ts (users,
// session cookie, NextRequest construction); the mock provider records every
// send as an SmsMessage row we can assert on.

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
