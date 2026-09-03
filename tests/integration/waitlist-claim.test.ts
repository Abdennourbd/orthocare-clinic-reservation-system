import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { WaitlistSource } from "@/generated/prisma/client";
import { bookSlot } from "@/lib/booking/bookSlot";
import { getClinicDayBoundsUTC, addClinicDays } from "@/lib/time/clinicTime";
import { localStart, nextOpenLocalDate } from "./helpers/testDates";

// Task 17 box 6 — claimed-slot cleanup: booking a watched date/service
// deactivates the watcher's matching ACTIVE entries (notifiedAt stays null,
// distinct from notified). Synthetic data only.

let seq = 100000;

function uniqPhone(): { phone: string; phoneE164: string } {
  seq++;
  const suffix = String(seq).padStart(4, "0");
  const phone = `05519${suffix.slice(-2)}${String(1000 + seq).slice(-4)}`.slice(0, 10);
  return { phone, phoneE164: `+213${phone.slice(1)}` };
}

async function createService(name = "Consultation") {
  seq++;
  return getPrisma().service.create({
    data: {
      slug: `claim-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${seq}`,
      name: { fr: name, ar: "استشارة", en: name },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
}

async function createPatient() {
  const { phone, phoneE164 } = uniqPhone();
  seq++;
  return getPrisma().patient.create({
    data: {
      firstName: "Karim",
      lastName: `Haddad${seq}`,
      phone,
      phoneE164,
      firstNameNormalized: "karim",
      lastNameNormalized: `haddad${seq}`,
    },
  });
}

beforeEach(async () => {
  await getPrisma().setting.createMany({
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
    ],
  });
});

describe("waitlist claimed-slot cleanup (Task 17 box 6)", () => {
  it("booking a watched date deactivates the entry with notifiedAt null", async () => {
    const service = await createService();
    const day = await nextOpenLocalDate(5);
    const patient = await createPatient();
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [getClinicDayBoundsUTC(day).startUTC],
        source: WaitlistSource.STAFF,
      },
    });

    await bookSlot({
      patientId: patient.id,
      serviceId: service.id,
      startUTC: localStart(day, "11:00"),
    });

    const after = await getPrisma().waitlistEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(after.active).toBe(false);
    expect(after.notifiedAt).toBeNull();
  });

  it("booking a different date or service leaves the entry active", async () => {
    const serviceA = await createService("Service A");
    const serviceB = await createService("Service B");
    const dayX = await nextOpenLocalDate(5);
    const otherDate = addClinicDays(dayX, 2);
    const patient = await createPatient();

    const eDate = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: serviceA.id,
        preferredDates: [getClinicDayBoundsUTC(otherDate).startUTC],
        source: WaitlistSource.STAFF,
      },
    });
    const eService = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: serviceB.id,
        preferredDates: [getClinicDayBoundsUTC(dayX).startUTC],
        source: WaitlistSource.STAFF,
      },
    });

    await bookSlot({
      patientId: patient.id,
      serviceId: serviceA.id,
      startUTC: localStart(dayX, "11:00"),
    });

    for (const id of [eDate.id, eService.id]) {
      const e = await getPrisma().waitlistEntry.findUniqueOrThrow({ where: { id } });
      expect(e.active).toBe(true);
      expect(e.notifiedAt).toBeNull();
    }
  });
});
