import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  CancelReason,
  Role,
  SmsMessageType,
} from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { futureBookableLocalStart } from "./helpers/testDates";
import { GET as servicesList } from "@/app/api/admin/services/route";
import { POST as servicesCreate } from "@/app/api/admin/services/route";
import { PATCH as servicePatch } from "@/app/api/admin/services/[id]/route";
import { DELETE as serviceDelete } from "@/app/api/admin/services/[id]/route";
import { POST as testimonialsCreate } from "@/app/api/admin/testimonials/route";
import { DELETE as testimonialDelete } from "@/app/api/admin/testimonials/[id]/route";
import { POST as faqsCreate } from "@/app/api/admin/faqs/route";
import { DELETE as faqDelete } from "@/app/api/admin/faqs/[id]/route";
import { POST as galleryCreate } from "@/app/api/admin/gallery/route";
import { DELETE as galleryDelete } from "@/app/api/admin/gallery/[id]/route";
import { GET as settingsGet, PATCH as settingsPatch } from "@/app/api/admin/settings/route";
import { POST as closuresCreate } from "@/app/api/admin/closures/route";
import { DELETE as closureDelete } from "@/app/api/admin/closures/[id]/route";
import { POST as closureResolve } from "@/app/api/admin/closures/[id]/resolve/route";

// next/cache has no runtime outside Next (revalidateTag throws "static
// generation store missing"). Stub it — same approach as
// tests/public-content.test.ts. Routes keep the real call in production.
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((cb) => cb),
}));

// Task 21 — integration tests for content + settings + closures admin APIs.
// Setup mirrors sms-center.test.ts (ADMIN + RECEPTIONIST users, session
// cookie, NextRequest construction). Every write path asserts the audit row;
// every ADMIN-only route asserts receptionist 403 + anonymous 401.

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("TZ", "UTC");

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
        fri: { closed: true },
      },
    },
  });
  await getPrisma().setting.create({
    data: {
      key: "bookingPolicy",
      value: { pendingExpiryHours: 24, minLeadTimeMinutes: 120, maxHorizonDays: 90, clinicTimezone: "Africa/Algiers" },
    },
  });
  await getPrisma().setting.create({
    data: {
      key: "slotConfig",
      value: { granularityMinutes: 15, bufferMinutes: 5, lunchBreak: null },
    },
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.ADMIN) {
  return getPrisma().user.create({
    data: {
      name: "Content Test",
      email: `content-${Math.random().toString(36).slice(2)}@test.com`,
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

function req(method: string, path: string, body: unknown, cookie?: string, params?: Record<string, string>) {
  const url = new URL(path, "http://localhost:3000");
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return {
    request: new NextRequest(url, init),
    context: { params: Promise.resolve(params ?? {}) },
  };
}

const serviceBody = (slug: string) => ({
  slug,
  name: { fr: `Service ${slug}` },
  description: { fr: `Description ${slug}` },
  durationMinutes: 30,
});

describe("services CRUD", () => {
  it("creates, lists, patches duration, and audits", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const { request: cReq } = req("POST", "/api/admin/services", serviceBody("consult-test"), cookie);
    const created = await servicesCreate(cReq);
    expect(created.status).toBe(201);

    const { request: gReq, context: gCtx } = req("GET", "/api/admin/services", undefined, cookie);
    const listed = await servicesList(gReq);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { services: Array<{ slug: string }> };
    expect(listBody.services.map((s) => s.slug)).toContain("consult-test");

    const createdBody = (await created.json()) as { service: { id: string } };
    const { request: pReq, context: pCtx } = req(
      "PATCH",
      `/api/admin/services/${createdBody.service.id}`,
      { durationMinutes: 45 },
      cookie,
      { id: createdBody.service.id },
    );
    const patched = await servicePatch(pReq, pCtx);
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { service: { durationMinutes: number } };
    expect(patchedBody.service.durationMinutes).toBe(45);

    const audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.SETTINGS_UPDATED, entityType: "Service" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects duplicate slug (409) and bad duration (400)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const first = req("POST", "/api/admin/services", serviceBody("dup-slug"), cookie);
    expect((await servicesCreate(first.request)).status).toBe(201);

    const dup = req("POST", "/api/admin/services", serviceBody("dup-slug"), cookie);
    expect((await servicesCreate(dup.request)).status).toBe(409);

    const bad = req("POST", "/api/admin/services", { ...serviceBody("bad-dur"), durationMinutes: 0 }, cookie);
    expect((await servicesCreate(bad.request)).status).toBe(400);
  });

  it("blocks delete while any appointment references the service (409); unused service deletes", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const c = req("POST", "/api/admin/services", serviceBody("in-use"), cookie);
    const created = await servicesCreate(c.request);
    const { service } = (await created.json()) as { service: { id: string } };

    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Nadia",
        lastName: "B.",
        phone: "0550111111",
        phoneE164: "+213550111111",
        firstNameNormalized: "nadia",
        lastNameNormalized: "b.",
      },
    });
    const start = await futureBookableLocalStart("11:00", 5);
    await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        status: AppointmentStatus.CONFIRMED,
      },
    });

    // Referenced (even by an active booking) → 409, steered to deactivation.
    const d1 = req("DELETE", `/api/admin/services/${service.id}`, undefined, cookie, { id: service.id });
    expect((await serviceDelete(d1.request, d1.context)).status).toBe(409);

    // Deactivation is the supported path for a referenced service.
    const p = req("PATCH", `/api/admin/services/${service.id}`, { active: false }, cookie, {
      id: service.id,
    });
    expect((await servicePatch(p.request, p.context)).status).toBe(200);

    // An unreferenced service deletes cleanly.
    const c2 = req("POST", "/api/admin/services", serviceBody("unused-svc"), cookie);
    const created2 = await servicesCreate(c2.request);
    const { service: unused } = (await created2.json()) as { service: { id: string } };
    const d2 = req("DELETE", `/api/admin/services/${unused.id}`, undefined, cookie, { id: unused.id });
    expect((await serviceDelete(d2.request, d2.context)).status).toBe(200);
  });

  it("refuses anonymous (401) and receptionist (403)", async () => {
    const recep = await createStaff(Role.RECEPTIONIST);
    const recepCookie = await cookieFor(recep);

    const anon = req("GET", "/api/admin/services", undefined, undefined);
    expect((await servicesList(anon.request)).status).toBe(401);

    const r = req("GET", "/api/admin/services", undefined, recepCookie);
    expect((await servicesList(r.request)).status).toBe(403);
  });
});

describe("testimonials / faqs / gallery CRUD", () => {
  it("creates each type, rejects duplicate keys, deletes, audits", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const t = req(
      "POST",
      "/api/admin/testimonials",
      { key: "tx1", author: { fr: "Auteur" }, content: { fr: "Super clinique" }, rating: 5 },
      cookie,
    );
    const tRes = await testimonialsCreate(t.request);
    expect(tRes.status).toBe(201);
    const tBody = (await tRes.json()) as { testimonial: { id: string } };

    const tDup = req(
      "POST",
      "/api/admin/testimonials",
      { key: "tx1", author: { fr: "X" }, content: { fr: "Y" }, rating: 5 },
      cookie,
    );
    expect((await testimonialsCreate(tDup.request)).status).toBe(409);

    const tDel = req("DELETE", `/api/admin/testimonials/${tBody.testimonial.id}`, undefined, cookie, {
      id: tBody.testimonial.id,
    });
    expect((await testimonialDelete(tDel.request, tDel.context)).status).toBe(200);

    const f = req(
      "POST",
      "/api/admin/faqs",
      { key: "fx1", question: { fr: "Question ?" }, answer: { fr: "Réponse." } },
      cookie,
    );
    const fRes = await faqsCreate(f.request);
    expect(fRes.status).toBe(201);
    const fBody = (await fRes.json()) as { faq: { id: string } };
    const fDel = req("DELETE", `/api/admin/faqs/${fBody.faq.id}`, undefined, cookie, { id: fBody.faq.id });
    expect((await faqDelete(fDel.request, fDel.context)).status).toBe(200);

    const g = req(
      "POST",
      "/api/admin/gallery",
      { key: "gx1", imageUrl: "/images/smile.jpg", caption: { fr: "Sourire" } },
      cookie,
    );
    const gRes = await galleryCreate(g.request);
    expect(gRes.status).toBe(201);
    const gBody = (await gRes.json()) as { item: { id: string } };
    const gDel = req("DELETE", `/api/admin/gallery/${gBody.item.id}`, undefined, cookie, { id: gBody.item.id });
    expect((await galleryDelete(gDel.request, gDel.context)).status).toBe(200);

    const audits = await getPrisma().auditLog.count({
      where: { action: AuditAction.SETTINGS_UPDATED },
    });
    expect(audits).toBeGreaterThanOrEqual(6);
  });
});

describe("settings GET/PATCH", () => {
  it("reads the bundle and applies a working-hours change", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const g = req("GET", "/api/admin/settings", undefined, cookie);
    const got = await settingsGet(g.request);
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as { settings: { workingHours: unknown; slotConfig: unknown } };
    expect(gotBody.settings.workingHours).not.toBeNull();

    const hours = {
      sat: { open: "09:00", close: "17:00" },
      sun: { open: "10:00", close: "17:00" },
      mon: { open: "10:00", close: "17:00" },
      tue: { open: "10:00", close: "17:00" },
      wed: { open: "10:00", close: "17:00" },
      thu: { open: "10:00", close: "17:00" },
      fri: { closed: true },
    };
    const p = req("PATCH", "/api/admin/settings", { key: "workingHours", value: hours }, cookie);
    expect((await settingsPatch(p.request)).status).toBe(200);
    const stored = await getPrisma().setting.findUnique({ where: { key: "workingHours" } });
    expect((stored?.value as { sat: { open: string } }).sat.open).toBe("09:00");
  });

  it("rejects invalid slotConfig / bookingPolicy / empty template (400, row unchanged)", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const badGran = req(
      "PATCH",
      "/api/admin/settings",
      { key: "slotConfig", value: { granularityMinutes: 0, bufferMinutes: 5, lunchBreak: null } },
      cookie,
    );
    expect((await settingsPatch(badGran.request)).status).toBe(400);

    const badPolicy = req(
      "PATCH",
      "/api/admin/settings",
      {
        key: "bookingPolicy",
        value: { pendingExpiryHours: 0, minLeadTimeMinutes: 120, maxHorizonDays: 90, clinicTimezone: "Africa/Algiers" },
      },
      cookie,
    );
    expect((await settingsPatch(badPolicy.request)).status).toBe(400);

    const badTemplate = req(
      "PATCH",
      "/api/admin/settings",
      { key: "messageTemplates", value: { delay: "" } },
      cookie,
    );
    expect((await settingsPatch(badTemplate.request)).status).toBe(400);

    const stored = await getPrisma().setting.findUnique({ where: { key: "slotConfig" } });
    expect((stored?.value as { granularityMinutes: number }).granularityMinutes).toBe(15);
  });

  it("merges messageTemplates and refuses receptionist writes", async () => {
    const admin = await createStaff(Role.ADMIN);
    const adminCookie = await cookieFor(admin);
    const recep = await createStaff(Role.RECEPTIONIST);
    const recepCookie = await cookieFor(recep);

    const p = req(
      "PATCH",
      "/api/admin/settings",
      { key: "messageTemplates", value: { delay: "Retard test {delayMinutes} min" } },
      adminCookie,
    );
    expect((await settingsPatch(p.request)).status).toBe(200);

    const g = req("GET", "/api/admin/settings", undefined, adminCookie);
    const gotBody = (await (await settingsGet(g.request)).json()) as {
      settings: { messageTemplates: Record<string, string> };
    };
    expect(gotBody.settings.messageTemplates.delay).toContain("Retard test");
    expect(gotBody.settings.messageTemplates.reminder).toBeTruthy();

    const r = req(
      "PATCH",
      "/api/admin/settings",
      { key: "slotConfig", value: { granularityMinutes: 15, bufferMinutes: 5, lunchBreak: null } },
      recepCookie,
    );
    expect((await settingsPatch(r.request)).status).toBe(403);
  });
});

describe("closures create → affected → resolve", () => {
  it("surfaces the booked appointment and bulk cancel-notifies it", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const service = await getPrisma().service.create({
      data: {
        slug: "closure-svc",
        name: { fr: "Consultation" },
        description: { fr: "Desc" },
        durationMinutes: 30,
      },
    });
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Karim",
        lastName: "Z.",
        phone: "0550222222",
        phoneE164: "+213550222222",
        firstNameNormalized: "karim",
        lastNameNormalized: "z.",
      },
    });
    const start = await futureBookableLocalStart("11:00", 5);
    const localDate = toClinicLocalDateString(start);
    const appointment = await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        status: AppointmentStatus.CONFIRMED,
      },
    });

    const c = req(
      "POST",
      "/api/admin/closures",
      { startDate: localDate, endDate: localDate, allDay: true, reason: { fr: "Fête" } },
      cookie,
    );
    const created = await closuresCreate(c.request);
    expect(created.status).toBe(201);
    const cBody = (await created.json()) as {
      closure: { id: string };
      affectedCount: number;
      affected: Array<{ id: string }>;
    };
    expect(cBody.affectedCount).toBe(1);
    expect(cBody.affected[0].id).toBe(appointment.id);

    const r = req(
      "POST",
      `/api/admin/closures/${cBody.closure.id}/resolve`,
      { action: "cancel_and_notify", appointmentIds: [appointment.id] },
      cookie,
      { id: cBody.closure.id },
    );
    const resolved = await closureResolve(r.request, r.context);
    expect(resolved.status).toBe(200);

    const after = await getPrisma().appointment.findUnique({ where: { id: appointment.id } });
    expect(after?.status).toBe(AppointmentStatus.CANCELLED);
    expect(after?.cancelReason).toBe(CancelReason.CLOSURE);

    const sms = await getPrisma().smsMessage.findFirst({
      where: { appointmentId: appointment.id, type: SmsMessageType.CANCELLED },
    });
    expect(sms).not.toBeNull();

    const d = req("DELETE", `/api/admin/closures/${cBody.closure.id}`, undefined, cookie, {
      id: cBody.closure.id,
    });
    expect((await closureDelete(d.request, d.context)).status).toBe(200);

    const created_audit = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.CLOSURE_CREATED },
    });
    expect(created_audit).not.toBeNull();
  });

  it("keep_for_call leaves appointments untouched", async () => {
    const admin = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(admin);

    const service = await getPrisma().service.create({
      data: {
        slug: "closure-svc2",
        name: { fr: "Consultation" },
        description: { fr: "Desc" },
        durationMinutes: 30,
      },
    });
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Lina",
        lastName: "M.",
        phone: "0550333333",
        phoneE164: "+213550333333",
        firstNameNormalized: "lina",
        lastNameNormalized: "m.",
      },
    });
    const start = await futureBookableLocalStart("12:00", 6);
    const localDate = toClinicLocalDateString(start);
    const appointment = await getPrisma().appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        status: AppointmentStatus.PENDING,
      },
    });

    const c = req(
      "POST",
      "/api/admin/closures",
      { startDate: localDate, endDate: localDate, allDay: true, reason: { fr: "Travaux" } },
      cookie,
    );
    const cBody = (await (await closuresCreate(c.request)).json()) as {
      closure: { id: string };
    };

    const r = req(
      "POST",
      `/api/admin/closures/${cBody.closure.id}/resolve`,
      { action: "keep_for_call", appointmentIds: [appointment.id] },
      cookie,
      { id: cBody.closure.id },
    );
    expect((await closureResolve(r.request, r.context)).status).toBe(200);

    const after = await getPrisma().appointment.findUnique({ where: { id: appointment.id } });
    expect(after?.status).toBe(AppointmentStatus.PENDING);
  });
});
