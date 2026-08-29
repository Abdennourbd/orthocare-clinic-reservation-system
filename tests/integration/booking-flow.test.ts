import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import { AppointmentStatus, WaitlistSource } from "@/generated/prisma/client";
import { GET as getServices } from "@/app/api/services/route";
import { GET as getServiceDetail } from "@/app/api/services/[slug]/route";
import { GET as getSlots } from "@/app/api/slots/route";
import { POST as postAppointments } from "@/app/api/appointments/route";
import { addClinicDays } from "@/lib/time/clinicTime";
import {
  localStart as localStartDate,
  nextOpenLocalDate,
  nextClosedLocalDate,
} from "./helpers/testDates";

// Wraps the shared Date-returning helper as an ISO string, matching this
// file's existing call sites (request bodies/query params want strings).
function localStart(localDate: string, hhmm: string): string {
  return localStartDate(localDate, hhmm).toISOString();
}

function postBooking(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return postAppointments(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function getSlotsRequest(
  serviceId: string,
  date: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return getSlots(
    new Request(
      `http://localhost/api/slots?serviceId=${serviceId}&date=${date}&locale=fr`,
      { headers },
    ),
  );
}

let serviceId: string;
let serviceSlug: string;
// Computed fresh each test from the workingHours fixture just inserted below
// — see tests/integration/helpers/testDates.ts for why these aren't literal
// "2026-08-29" strings.
let openDate: string;
let closedDate: string;

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
  serviceSlug = service.slug;

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
  closedDate = await nextClosedLocalDate();
});

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceId,
    startTime: localStart(openDate, "11:00"),
    patient: {
      firstName: "Yasmine",
      lastName: "Khelifi",
      phone: "0551122334",
    },
    consent: true,
    consentVersion: "1.0",
    ...overrides,
  };
}

describe("GET /api/services", () => {
  it("lists active services localized per locale", async () => {
    const res = await getServices(
      new Request("http://localhost/api/services?locale=ar"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({
      slug: "consultation-30",
      name: "استشارة",
      durationMinutes: 30,
    });
  });
});

describe("GET /api/services/[slug]", () => {
  it("returns a service detail", async () => {
    const res = await getServiceDetail(
      new Request("http://localhost/api/services/consultation-30?locale=fr"),
      { params: Promise.resolve({ slug: serviceSlug }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service.slug).toBe("consultation-30");
    expect(body.service.durationMinutes).toBe(30);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await getServiceDetail(
      new Request("http://localhost/api/services/nope?locale=fr"),
      { params: Promise.resolve({ slug: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/slots", () => {
  it("returns available + occupied slots; a booked slot is marked occupied", async () => {
    // Book 11:00 local (10:00 UTC) first.
    const booked = await postBooking(bookingBody());
    expect(booked.status).toBe(201);

    const res = await getSlotsRequest(serviceId, openDate);
    expect(res.status).toBe(200);
    const body = await res.json();

    const expectedStartUTC = `${openDate}T10:00:00.000Z`;
    const occupiedUTC = body.occupied.map((s: { startUTC: string }) => s.startUTC);
    expect(occupiedUTC).toContain(expectedStartUTC); // 11:00 local
    expect(body.available.some((s: { startUTC: string }) => s.startUTC === expectedStartUTC)).toBe(false);

    // Slots carry clinic-local times for display.
    const eleven = body.occupied.find(
      (s: { startUTC: string }) => s.startUTC === expectedStartUTC,
    );
    expect(eleven.localTime).toBe("11:00");
  });

  it("returns empty lists on a closed day (Friday)", async () => {
    const res = await getSlotsRequest(serviceId, closedDate);
    const body = await res.json();
    expect(body.available).toHaveLength(0);
    expect(body.occupied).toHaveLength(0);
  });

  it("returns 400 for a missing serviceId or malformed date", async () => {
    expect((await getSlots(new Request(`http://localhost/api/slots?date=${openDate}`))).status).toBe(400);
    expect((await getSlots(new Request("http://localhost/api/slots?serviceId=x&date=bad"))).status).toBe(400);
  });

  it("returns 404 for an unknown service", async () => {
    const res = await getSlots(new Request(`http://localhost/api/slots?serviceId=nope&date=${openDate}`));
    expect(res.status).toBe(404);
  });

  it("rate-limits GET /api/slots per IP (120/min)", async () => {
    const headers = { "x-real-ip": "9.9.9.9" };
    for (let i = 0; i < 120; i++) {
      const res = await getSlotsRequest(serviceId, openDate, headers);
      expect(res.status).toBe(200);
    }
    const overflow = await getSlotsRequest(serviceId, openDate, headers);
    expect(overflow.status).toBe(429);
    const body = await overflow.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 30_000);
});

describe("POST /api/appointments", () => {
  it("creates a PENDING booking with consent + normalized phone (happy path)", async () => {
    const res = await postBooking(bookingBody());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.appointment.status).toBe(AppointmentStatus.PENDING);

    const prisma = getPrisma();
    const patient = await prisma.patient.findFirst({
      where: { phoneE164: "+213551122334" },
    });
    expect(patient).not.toBeNull();
    expect(patient!.firstName).toBe("Yasmine");
    expect(patient!.consentAt).toBeInstanceOf(Date);
    expect(patient!.consentVersion).toBe("1.0");

    const appt = await prisma.appointment.findUnique({
      where: { id: body.appointment.id },
      include: { service: true },
    });
    expect(appt!.status).toBe(AppointmentStatus.PENDING);
    expect(appt!.source).toBe("ONLINE");
    expect(appt!.startTime.toISOString()).toBe(`${openDate}T10:00:00.000Z`);
  });

  it("creates a PENDING booking with a filled birth date", async () => {
    const res = await postBooking(
      bookingBody({
        patient: {
          firstName: "Yasmine",
          lastName: "Khelifi",
          phone: "0551122334",
          birthDate: "1990-05-12",
        },
      }),
    );
    expect(res.status).toBe(201);

    const patient = await getPrisma().patient.findFirst({
      where: { phoneE164: "+213551122334" },
    });
    expect(patient!.birthDate).not.toBeNull();
  });

  it("rejects a malformed JSON body with 400 INVALID_JSON", async () => {
    const res = await postAppointments(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"serviceId": "abc", "startTime": "not',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_JSON");
    // Nothing was created.
    expect(await getPrisma().appointment.count()).toBe(0);
  });

  it("rejects a booking of an already-taken slot with 409", async () => {
    expect((await postBooking(bookingBody())).status).toBe(201);
    const second = await postBooking(bookingBody());
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("SLOT_CONFLICT");
  });

  it("rejects a booking without explicit consent", async () => {
    const res = await postBooking(bookingBody({ consent: false }));
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognized phone number", async () => {
    // Passes Zod's length check but is not a valid Algerian number.
    const res = await postBooking(
      bookingBody({ patient: { firstName: "X", lastName: "Y", phone: "abcdefgh" } }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects a stale consent version", async () => {
    const res = await postBooking(bookingBody({ consentVersion: "0.9" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("STALE_CONSENT");
  });

  it("rejects watch dates in the past without creating a booking", async () => {
    // A date guaranteed to be in the past relative to the real clock.
    const res = await postBooking(bookingBody({ watchDates: ["2020-01-01"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_WATCH_DATES");

    const count = await getPrisma().appointment.count();
    expect(count).toBe(0);
  });

  it("creates a PATIENT-source waitlist entry on the cancellation-watch opt-in", async () => {
    const res = await postBooking(
      bookingBody({
        watchDates: [addClinicDays(openDate, 1), addClinicDays(openDate, 2)],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.waitlistCreated).toBe(true);

    const entry = await getPrisma().waitlistEntry.findFirst({
      where: { serviceId, source: WaitlistSource.PATIENT },
    });
    expect(entry).not.toBeNull();
    expect(entry!.active).toBe(true);
    expect(entry!.preferredDates).toHaveLength(2);
  });

  it("does not create a waitlist entry when the patient declines the opt-in", async () => {
    const res = await postBooking(bookingBody());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.waitlistCreated).toBe(false);
    expect(await getPrisma().waitlistEntry.count()).toBe(0);
  });

  it("rejects a cross-origin booking when APP_URL is configured", async () => {
    vi.stubEnv("APP_URL", "https://orthocare-clinic.example.com");
    const res = await postBooking(
      bookingBody({ startTime: localStart(openDate, "10:00") }),
      { origin: "https://evil.example.com" },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    // Nothing was booked.
    expect(await getPrisma().appointment.count()).toBe(0);
  });

  it("accepts a same-site origin when APP_URL is configured", async () => {
    vi.stubEnv("APP_URL", "https://orthocare-clinic.example.com");
    const res = await postBooking(
      bookingBody({ startTime: localStart(openDate, "10:00") }),
      { origin: "https://orthocare-clinic.example.com" },
    );
    expect(res.status).toBe(201);
  });

  it("rate-limits a phone that floods (consumed tokens from failing requests)", async () => {
    // 5 requests with a stale consent each consume a per-phone token but
    // never book. The 6th — even a valid one — is rate-limited.
    for (let i = 0; i < 5; i++) {
      const res = await postBooking(bookingBody({ consentVersion: "0.9" }));
      expect(res.status).toBe(400);
    }
    const sixth = await postBooking(bookingBody());
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("caps simultaneously active PENDING bookings per phone", async () => {
    const times = ["10:00", "10:45", "11:30"];
    for (const t of times) {
      const res = await postBooking(bookingBody({ startTime: localStart(openDate, t) }));
      expect(res.status).toBe(201);
    }
    const fourth = await postBooking(
      bookingBody({ startTime: localStart(openDate, "12:15") }),
    );
    expect(fourth.status).toBe(429);
    const body = await fourth.json();
    expect(body.error.code).toBe("PENDING_LIMIT");
  });

  it("rate-limits a single IP that floods", async () => {
    const headers = { "x-real-ip": "1.2.3.4" };
    // Each request uses a fresh phone so only the IP limit accumulates; they
    // all target the same (already-taken) slot so only the first books.
    for (let i = 0; i < 20; i++) {
      const phone = `0${5}${String(i).padStart(8, "0")}`;
      const res = await postBooking(
        bookingBody({ patient: { firstName: "X", lastName: "Y", phone } }),
        headers,
      );
      // First request books; the rest conflict on the same slot — but each
      // consumes an IP rate-limit token, which is what this test exercises.
      expect([201, 409]).toContain(res.status);
    }
    const overflow = await postBooking(
      bookingBody({
        patient: { firstName: "X", lastName: "Y", phone: "0551234567" },
      }),
      headers,
    );
    expect(overflow.status).toBe(429);
    const body = await overflow.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});