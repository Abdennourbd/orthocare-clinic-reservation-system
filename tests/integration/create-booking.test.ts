import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { AppointmentStatus, WaitlistSource } from "@/generated/prisma/client";
import { createBooking } from "@/lib/booking/createBooking";
import { SlotConflictError } from "@/lib/booking/bookSlot";
import { PendingLimitError } from "@/lib/booking/errors";
import { bookSlot } from "@/lib/booking/bookSlot";
import { getClinicDayBoundsUTC, addClinicDays } from "@/lib/time/clinicTime";
import {
  localStart,
  futureBookableLocalStart,
  nextOpenLocalDate,
} from "./helpers/testDates";

let serviceId: string;
let patientId: string;
// Computed fresh each test from the workingHours fixture just inserted below
// — see tests/integration/helpers/testDates.ts for why these aren't literal
// "2026-08-29" strings. `futureBookableLocalStart` (extracted to that shared
// module — was previously local to this file, Task 13 étape 4 tour 2) is
// reused directly by the phone-sharing/record-mixup cases further down.
let openDate: string;

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

  openDate = await nextOpenLocalDate();
});

const patientInput = {
  firstName: "Yasmine",
  lastName: "Khelifi",
  phone: "0551122334",
  phoneE164: "+213551122334",
  consentAt: new Date(),
  consentVersion: "1.0",
  preferredLocale: "fr",
  whatsappOptIn: false,
};

describe("createBooking", () => {
  it("creates a PENDING appointment and a patient with consent recorded", async () => {
    const result = await createBooking({
      serviceId,
      startUTC: localStart(openDate, "11:00"),
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
      startUTC: localStart(openDate, "11:00"),
      patient: patientInput,
    });

    const second = await createBooking({
      serviceId,
      startUTC: localStart(openDate, "14:00"),
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
      startUTC: localStart(openDate, "11:00"),
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
      startUTC: localStart(openDate, "14:00"),
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
      startUTC: localStart(openDate, "11:00"),
      patient: patientInput,
      watchDates: [addClinicDays(openDate, 1), addClinicDays(openDate, 2)],
    });

    expect(result.waitlistEntry).not.toBeNull();
    expect(result.waitlistEntry!.source).toBe(WaitlistSource.PATIENT);
    expect(result.waitlistEntry!.active).toBe(true);

    // preferredDates stored as each clinic-local date's UTC midnight.
    const expected = [
      getClinicDayBoundsUTC(addClinicDays(openDate, 1)).startUTC,
      getClinicDayBoundsUTC(addClinicDays(openDate, 2)).startUTC,
    ];
    expect(result.waitlistEntry!.preferredDates).toHaveLength(2);
    expect(result.waitlistEntry!.preferredDates.map((d) => d.toISOString())).toEqual(
      expected.map((d) => d.toISOString()),
    );
  });

  it("excludes the booked date itself from watchDates", async () => {
    const result = await createBooking({
      serviceId,
      startUTC: localStart(openDate, "11:00"),
      patient: patientInput,
      watchDates: [openDate, addClinicDays(openDate, 1)],
    });

    const stored = result.waitlistEntry!.preferredDates.map((d) =>
      d.toISOString(),
    );
    expect(stored).toEqual([
      getClinicDayBoundsUTC(addClinicDays(openDate, 1)).startUTC.toISOString(),
    ]);
  });

  it("serializes concurrent bookings from one phone: PENDING cap + no duplicate patient", async () => {
    const times = ["10:00", "10:45", "11:30", "12:15"].map((t) =>
      localStart(openDate, t),
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

  // Task 13 étape 4 tour 2 — proves the BLOCKING record-mixup defect
  // (ortho-security) and its fix. Two patients legitimately share one phone
  // (a family, per task-13.md's scenario) — created directly here since the
  // admin route's phoneSharingAcknowledged gate is Part 1 of this tour, not
  // exercised by createBooking. A later public booking with that shared
  // phone and the FIRST patient's name must update ONLY that patient: it
  // must never silently overwrite whichever record happens to be most
  // recent (the pre-fix behavior), which would relabel a stranger's record
  // with someone else's identity while leaving their clinical history
  // attached to the wrong name.
  it("resolves a shared-phone booking by NAME, not by recency: does not mix up two family members' records", async () => {
    const prisma = getPrisma();
    const sharedPhoneE164 = "+213550700001";

    // Task 13 étape 4 tour 3 (ortho-security counter-check): `createdAt` is a
    // `timestamp(3)` column and these two INSERTs, issued back-to-back, can
    // easily land in the same millisecond (measured locally: 49/59 consecutive
    // INSERT pairs tied). Without an explicit, distinct `createdAt`, the
    // pre-fix `findFirst({ orderBy: { createdAt: "desc" } })` would resolve a
    // tie by physical row order — not creation order — making this test's
    // ability to catch the record-mixup defect a coin flip. An explicit gap
    // forces the pre-fix code to behave deterministically, so this test bites
    // 100% of the time, not ~50%.
    const familyMember1 = await prisma.patient.create({
      data: {
        firstName: "Amine",
        lastName: "Belaid",
        phone: "0550700001",
        phoneE164: sharedPhoneE164,
        notes: "CLINICAL-MARKER-AMINE",
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    // Created AFTER member 1 (explicit, distinct `createdAt` — see above) —
    // under the pre-fix `orderBy: createdAt desc` `findFirst`, this is the
    // record a phone-only lookup would resolve to, regardless of whose name
    // is actually booking.
    const familyMember2 = await prisma.patient.create({
      data: {
        firstName: "Yacine",
        lastName: "Belaid",
        phone: "0550700001",
        phoneE164: sharedPhoneE164,
        notes: "CLINICAL-MARKER-YACINE",
      },
    });

    const result = await createBooking({
      serviceId,
      startUTC: await futureBookableLocalStart("11:00"),
      patient: {
        ...patientInput,
        firstName: "Amine",
        lastName: "Belaid",
        phone: "0550700001",
        phoneE164: sharedPhoneE164,
      },
    });

    // The booking must resolve to member 1 (matching name), never create a
    // third row, and never touch member 2 at all.
    expect(result.patient.id).toBe(familyMember1.id);
    expect(await prisma.patient.count({ where: { phoneE164: sharedPhoneE164 } })).toBe(2);

    const reloadedMember1 = await prisma.patient.findUniqueOrThrow({
      where: { id: familyMember1.id },
    });
    const reloadedMember2 = await prisma.patient.findUniqueOrThrow({
      where: { id: familyMember2.id },
    });

    // Member 1: identity unchanged (it matched, so update is a no-op on
    // name), clinical note untouched.
    expect(reloadedMember1.firstName).toBe("Amine");
    expect(reloadedMember1.lastName).toBe("Belaid");
    expect(reloadedMember1.notes).toBe("CLINICAL-MARKER-AMINE");

    // Member 2 is the record the pre-fix bug silently overwrote with
    // "Amine"/"Belaid" (the most recently created row sharing the phone).
    // This is the assertion that fails on the unfixed implementation.
    expect(reloadedMember2.firstName).toBe("Yacine");
    expect(reloadedMember2.lastName).toBe("Belaid");
    expect(reloadedMember2.notes).toBe("CLINICAL-MARKER-YACINE");

    // The appointment is attributed to the right person.
    expect(result.appointment.patientId).toBe(familyMember1.id);
  });

  it("creates a NEW patient when a shared phone is booked under a name that matches NEITHER existing record", async () => {
    const prisma = getPrisma();
    const sharedPhoneE164 = "+213550700002";

    // Same explicit-`createdAt` rationale as the previous test (Task 13 étape
    // 4 tour 3): avoids a `createdAt` tie between these two back-to-back
    // INSERTs, keeping the fixture deterministic.
    const familyMember1 = await prisma.patient.create({
      data: {
        firstName: "Amine",
        lastName: "Belaid",
        phone: "0550700002",
        phoneE164: sharedPhoneE164,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    const familyMember2 = await prisma.patient.create({
      data: {
        firstName: "Yacine",
        lastName: "Belaid",
        phone: "0550700002",
        phoneE164: sharedPhoneE164,
      },
    });

    const result = await createBooking({
      serviceId,
      startUTC: await futureBookableLocalStart("11:00"),
      patient: {
        ...patientInput,
        firstName: "Karima",
        lastName: "Belaid",
        phone: "0550700002",
        phoneE164: sharedPhoneE164,
      },
    });

    expect(result.patient.id).not.toBe(familyMember1.id);
    expect(result.patient.id).not.toBe(familyMember2.id);
    expect(result.patient.firstName).toBe("Karima");
    expect(await prisma.patient.count({ where: { phoneE164: sharedPhoneE164 } })).toBe(3);

    // Existing records untouched.
    const reloadedMember1 = await prisma.patient.findUniqueOrThrow({
      where: { id: familyMember1.id },
    });
    const reloadedMember2 = await prisma.patient.findUniqueOrThrow({
      where: { id: familyMember2.id },
    });
    expect(reloadedMember1.firstName).toBe("Amine");
    expect(reloadedMember2.firstName).toBe("Yacine");
  });

  it("never reactivates a soft-deleted patient (active: false) via a public booking", async () => {
    const prisma = getPrisma();
    const deactivated = await prisma.patient.create({
      data: {
        firstName: "Nadir",
        lastName: "Chaouch",
        phone: "0550700003",
        phoneE164: "+213550700003",
        active: false,
      },
    });

    const result = await createBooking({
      serviceId,
      startUTC: await futureBookableLocalStart("11:00"),
      patient: {
        ...patientInput,
        firstName: "Nadir",
        lastName: "Chaouch",
        phone: "0550700003",
        phoneE164: "+213550700003",
      },
    });

    expect(result.patient.id).toBe(deactivated.id);
    const reloaded = await prisma.patient.findUniqueOrThrow({
      where: { id: deactivated.id },
    });
    expect(reloaded.active).toBe(false);
  });

  // Task 13 étape 5 (§Contraintes obligatoires issues de l'audit de l'étape
  // 4, point 7 — prepares étape 6's anonymization): `upsertPatient()` must
  // exclude anonymized records from its phone+name match, otherwise a public
  // booking could resolve onto an erased fiche and re-write a real
  // firstName/lastName/consent back onto it — silently undoing a
  // right-to-be-forgotten request.
  it("never resolves onto an anonymized patient: creates a fresh record instead of reviving the erased one", async () => {
    const prisma = getPrisma();
    const erased = await prisma.patient.create({
      data: {
        firstName: "Anonyme",
        lastName: "Anonyme",
        phone: "0550700004",
        phoneE164: "+213550700004",
        anonymizedAt: new Date(),
        notes: null,
      },
    });

    const result = await createBooking({
      serviceId,
      startUTC: await futureBookableLocalStart("11:00"),
      patient: {
        ...patientInput,
        firstName: "Nadir",
        lastName: "Chaouch",
        phone: "0550700004",
        phoneE164: "+213550700004",
      },
    });

    expect(result.patient.id).not.toBe(erased.id);
    expect(result.patient.firstName).toBe("Nadir");

    // The erased record itself must stay untouched — still anonymized,
    // still carrying its placeholder identity.
    const reloadedErased = await prisma.patient.findUniqueOrThrow({
      where: { id: erased.id },
    });
    expect(reloadedErased.anonymizedAt).not.toBeNull();
    expect(reloadedErased.firstName).toBe("Anonyme");
    expect(reloadedErased.lastName).toBe("Anonyme");
  });

  it("rolls back the patient and waitlist entry when the slot is taken", async () => {
    // Occupy the slot first (existing seeded patient).
    await bookSlot({ patientId, serviceId, startUTC: localStart(openDate, "11:00") });

    await expect(
      createBooking({
        serviceId,
        startUTC: localStart(openDate, "11:00"),
        patient: { ...patientInput, phoneE164: "+213660000000", phone: "0660000000" },
        watchDates: [addClinicDays(openDate, 1)],
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