import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { AppointmentStatus, WaitlistSource } from "@/generated/prisma/client";
import { createBooking } from "@/lib/booking/createBooking";
import { SlotConflictError } from "@/lib/booking/bookSlot";
import { PendingLimitError } from "@/lib/booking/errors";
import { bookSlot } from "@/lib/booking/bookSlot";
import { getClinicDayBoundsUTC } from "@/lib/time/clinicTime";

function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

let serviceId: string;
let patientId: string;

beforeEach(async () => {
  const prisma = getPrisma();

  const patient = await prisma.patient.create({
    data: {
      firstName: "Samir",
      lastName: "Benali",
      phone: "0550998877",
      phoneE164: "+213550998877",
    },
  });
  patientId = patient.id;

  const service = await prisma.service.create({
    data: {
      slug: "consultation-30",
      name: { fr: "Consultation", ar: "استشارة", en: "Consultation" },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
  serviceId = service.id;

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

const patientInput = {
  firstName: "Yasmine",
  lastName: "Khelifi",
  phone: "0551122334",
  phoneE164: "+213551122334",
  consentAt: new Date(),
  consentVersion: "1.0",
};

describe("createBooking", () => {
  it("creates a PENDING appointment and a patient with consent recorded", async () => {
    const result = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "11:00"),
      patient: patientInput,
    });

    expect(result.appointment.status).toBe(AppointmentStatus.PENDING);
    expect(result.appointment.source).toBe("ONLINE");
    expect(result.patient.phoneE164).toBe("+213551122334");
    expect(result.patient.consentAt).toBeInstanceOf(Date);
    expect(result.patient.consentVersion).toBe("1.0");
    expect(result.waitlistEntry).toBeNull();
  });

  it("upserts an existing patient by phoneE164 instead of duplicating", async () => {
    const first = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "11:00"),
      patient: patientInput,
    });

    const second = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "14:00"),
      patient: { ...patientInput, firstName: "Yasmine" },
    });

    expect(second.patient.id).toBe(first.patient.id);
    const count = await getPrisma().patient.count({
      where: { phoneE164: "+213551122334" },
    });
    expect(count).toBe(1);
  });

  it("preserves a patient's optional email/birthDate when a re-booking omits them", async () => {
    const first = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "11:00"),
      patient: {
        ...patientInput,
        email: "yasmine@example.com",
        birthDate: new Date("1990-05-12T00:00:00.000Z"),
      },
    });

    // Re-booking with the same phone but a blank form (no email/birthDate)
    // must NOT erase the previously captured values.
    const second = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "14:00"),
      patient: patientInput,
    });

    expect(second.patient.id).toBe(first.patient.id);
    expect(second.patient.email).toBe("yasmine@example.com");
    expect(second.patient.birthDate?.toISOString()).toBe(
      "1990-05-12T00:00:00.000Z",
    );
  });

  it("creates a PATIENT-source WaitlistEntry in the same transaction when watchDates given", async () => {
    const result = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "11:00"),
      patient: patientInput,
      watchDates: ["2026-08-30", "2026-08-31"],
    });

    expect(result.waitlistEntry).not.toBeNull();
    expect(result.waitlistEntry!.source).toBe(WaitlistSource.PATIENT);
    expect(result.waitlistEntry!.active).toBe(true);

    // preferredDates stored as each clinic-local date's UTC midnight.
    const expected = [
      getClinicDayBoundsUTC("2026-08-30").startUTC,
      getClinicDayBoundsUTC("2026-08-31").startUTC,
    ];
    expect(result.waitlistEntry!.preferredDates).toHaveLength(2);
    expect(result.waitlistEntry!.preferredDates.map((d) => d.toISOString())).toEqual(
      expected.map((d) => d.toISOString()),
    );
  });

  it("excludes the booked date itself from watchDates", async () => {
    const result = await createBooking({
      serviceId,
      startUTC: localStart("2026-08-29", "11:00"),
      patient: patientInput,
      watchDates: ["2026-08-29", "2026-08-30"],
    });

    const stored = result.waitlistEntry!.preferredDates.map((d) =>
      d.toISOString(),
    );
    expect(stored).toEqual([getClinicDayBoundsUTC("2026-08-30").startUTC.toISOString()]);
  });

  it("serializes concurrent bookings from one phone: PENDING cap + no duplicate patient", async () => {
    const times = ["10:00", "10:45", "11:30", "12:15"].map((t) =>
      localStart("2026-08-29", t),
    );

    const results = await Promise.allSettled(
      times.map((startUTC) =>
        createBooking({
          serviceId,
          startUTC,
          maxActivePending: 3,
          patient: patientInput,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // 4 distinct, non-overlapping slots but a cap of 3 → exactly one is
    // rejected by the authoritative in-transaction cap check.
    expect(fulfilled.length).toBe(3);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PendingLimitError,
    );

    // The per-phone advisory lock also prevents the findFirst-then-create
    // upsert from producing duplicate patients under concurrency.
    const patientCount = await getPrisma().patient.count({
      where: { phoneE164: "+213551122334" },
    });
    expect(patientCount).toBe(1);
  });

  it("rolls back the patient and waitlist entry when the slot is taken", async () => {
    // Occupy the slot first (existing seeded patient).
    await bookSlot({ patientId, serviceId, startUTC: localStart("2026-08-29", "11:00") });

    await expect(
      createBooking({
        serviceId,
        startUTC: localStart("2026-08-29", "11:00"),
        patient: { ...patientInput, phoneE164: "+213660000000", phone: "0660000000" },
        watchDates: ["2026-08-30"],
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);

    // No orphan patient row and no orphan waitlist entry.
    const patients = await getPrisma().patient.findMany({
      where: { phoneE164: "+213660000000" },
    });
    expect(patients).toHaveLength(0);
    const waitlist = await getPrisma().waitlistEntry.count();
    expect(waitlist).toBe(0);
  });
});