import { describe, it, expect, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  SmsMessageType,
  WaitlistSource,
} from "@/generated/prisma/client";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { emitSlotFreedAsync, type SlotFreedEvent } from "@/lib/booking/events";
import {
  handleSlotFreed,
  subscribeWaitlist,
} from "./notifyWaitlist";

let seq = 0;

async function createPatient(overrides: Record<string, unknown> = {}) {
  seq++;
  return getPrisma().patient.create({
    data: {
      firstName: "Sara",
      lastName: "Benali",
      phone: `05510000${String(seq).padStart(2, "0")}`,
      phoneE164: `+2135510000${String(seq).padStart(2, "0")}`,
      ...(overrides as Record<string, string>),
    },
  });
}

async function createService() {
  seq++;
  return getPrisma().service.create({
    data: {
      slug: `consultation-${Date.now()}-${seq}`,
      name: { fr: "Consultation", ar: "استشارة", en: "Consultation" },
      description: { fr: "D", ar: "و", en: "D" },
      durationMinutes: 30,
    },
  });
}

/** Clinic-local date stored as UTC midnight (schema convention). */
function utcMidnight(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function slotEvent(
  serviceId: string,
  startTime: Date,
  minutes = 30,
): SlotFreedEvent {
  return {
    appointmentId: `appt-${serviceId.slice(-4)}-${startTime.getTime()}`,
    serviceId,
    resourceId: null,
    startTime,
    endTime: new Date(startTime.getTime() + minutes * 60_000),
  };
}

describe("handleSlotFreed (Task 17.1)", () => {
  it("notifies the entry matching service+date, silent for a non-matching service", async () => {
    const serviceA = await createService();
    const serviceB = await createService();
    const patientA = await createPatient();
    const patientB = await createPatient();
    const watched = "2026-09-02";
    // 11:00 clinic-local = 10:00Z.
    const startTime = new Date("2026-09-02T10:00:00.000Z");
    expect(toClinicLocalDateString(startTime)).toBe(watched);

    const entryA = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patientA.id,
        serviceId: serviceA.id,
        preferredDates: [utcMidnight(watched)],
        source: WaitlistSource.PATIENT,
      },
    });
    const entryB = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patientB.id,
        serviceId: serviceB.id,
        preferredDates: [utcMidnight(watched)],
        source: WaitlistSource.PATIENT,
      },
    });

    const notified = await handleSlotFreed(slotEvent(serviceA.id, startTime));

    expect(notified).toBe(1);
    const afterA = await getPrisma().waitlistEntry.findUnique({
      where: { id: entryA.id },
    });
    expect(afterA!.active).toBe(false);
    expect(afterA!.notifiedAt).toBeInstanceOf(Date);
    const afterB = await getPrisma().waitlistEntry.findUnique({
      where: { id: entryB.id },
    });
    expect(afterB!.active).toBe(true);
    expect(afterB!.notifiedAt).toBeNull();

    const messages = await getPrisma().smsMessage.findMany({
      where: { type: SmsMessageType.WAITLIST },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].patientId).toBe(patientA.id);
    expect(messages[0].body).toContain("Sara");
    expect(messages[0].body).toContain("Consultation");
  });

  it("stays silent when no entry watches the freed date", async () => {
    const service = await createService();
    const patient = await createPatient();
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-05")],
        source: WaitlistSource.STAFF,
      },
    });

    const notified = await handleSlotFreed(
      slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")),
    );

    expect(notified).toBe(0);
    const after = await getPrisma().waitlistEntry.findUnique({
      where: { id: entry.id },
    });
    expect(after!.active).toBe(true);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST },
      }),
    ).toBe(0);
  });

  it("matches on the clinic-local date, not the UTC day (23:30Z edge)", async () => {
    const service = await createService();
    // 2026-09-02T23:30:00Z = 2026-09-03 00:30 clinic-local (UTC+1).
    const startTime = new Date("2026-09-02T23:30:00.000Z");
    expect(toClinicLocalDateString(startTime)).toBe("2026-09-03");

    const localPatient = await createPatient();
    const utcPatient = await createPatient();
    const localEntry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: localPatient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-03")],
        source: WaitlistSource.PATIENT,
      },
    });
    const utcEntry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: utcPatient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.PATIENT,
      },
    });

    const notified = await handleSlotFreed(slotEvent(service.id, startTime));

    expect(notified).toBe(1);
    expect(
      (await getPrisma().waitlistEntry.findUnique({
        where: { id: localEntry.id },
      }))!.active,
    ).toBe(false);
    expect(
      (await getPrisma().waitlistEntry.findUnique({
        where: { id: utcEntry.id },
      }))!.active,
    ).toBe(true);
  });

  it("suppresses opted-out/inactive patients and leaves their entries active", async () => {
    const service = await createService();
    const startTime = new Date("2026-09-02T10:00:00.000Z");
    const optedOut = await createPatient({ messagingOptOut: true });
    const inactive = await createPatient({ active: false });
    const entryOpt = await getPrisma().waitlistEntry.create({
      data: {
        patientId: optedOut.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.PATIENT,
      },
    });
    const entryInactive = await getPrisma().waitlistEntry.create({
      data: {
        patientId: inactive.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.STAFF,
      },
    });

    const notified = await handleSlotFreed(slotEvent(service.id, startTime));

    expect(notified).toBe(0);
    for (const id of [entryOpt.id, entryInactive.id]) {
      const after = await getPrisma().waitlistEntry.findUnique({
        where: { id },
      });
      // Suppressed (dispatcher returned null): stays active for the next
      // opportunity, notifiedAt untouched.
      expect(after!.active).toBe(true);
      expect(after!.notifiedAt).toBeNull();
    }
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST },
      }),
    ).toBe(0);
  });

  it("skips anonymized patients explicitly", async () => {
    const service = await createService();
    const patient = await createPatient({ anonymizedAt: new Date() });
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.PATIENT,
      },
    });

    const notified = await handleSlotFreed(
      slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")),
    );

    expect(notified).toBe(0);
    const after = await getPrisma().waitlistEntry.findUnique({
      where: { id: entry.id },
    });
    expect(after!.active).toBe(true);
  });

  it("deactivates on notify so a second event does not re-notify", async () => {
    const service = await createService();
    const patient = await createPatient();
    await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.PATIENT,
      },
    });
    const event = slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z"));

    expect(await handleSlotFreed(event)).toBe(1);
    // No appointmentId on the message (same reason as the Task 16 delay
    // broadcast): a second freed slot must not hit the unique index.
    expect(await handleSlotFreed(event)).toBe(0);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST },
      }),
    ).toBe(1);
  });

  it("treats PATIENT and STAFF sources identically", async () => {
    const service = await createService();
    for (const source of [WaitlistSource.PATIENT, WaitlistSource.STAFF]) {
      const patient = await createPatient();
      await getPrisma().waitlistEntry.create({
        data: {
          patientId: patient.id,
          serviceId: service.id,
          preferredDates: [utcMidnight("2026-09-02")],
          source,
        },
      });
    }

    const notified = await handleSlotFreed(
      slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")),
    );

    expect(notified).toBe(2);
  });

  it("never rejects when the provider throws (cancellation must not 500)", async () => {
    const service = await createService();
    const patient = await createPatient();
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.PATIENT,
      },
    });
    const failingProvider = {
      name: "mock" as const,
      send: async () => {
        throw new Error("provider down");
      },
    };

    await expect(
      handleSlotFreed(
        slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")),
        failingProvider,
      ),
    ).resolves.not.toThrow();

    // The dispatcher records the throw as FAILED and still returns the row, so
    // the entry is consumed (non-null = sent path) rather than retried forever.
    const after = await getPrisma().waitlistEntry.findUnique({
      where: { id: entry.id },
    });
    expect(after!.active).toBe(false);
  });

  it("releases the claim when the send itself throws (entry keeps its place)", async () => {
    const service = await createService();
    const patient = await createPatient();
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.STAFF,
      },
    });
    // A transient DB failure inside the dispatcher's row write: sendMessage
    // throws instead of returning a row.
    const spy = vi
      .spyOn(getPrisma().smsMessage, "create")
      .mockRejectedValueOnce(new Error("db down"));

    await expect(
      handleSlotFreed(slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z"))),
    ).resolves.not.toThrow();
    spy.mockRestore();

    // Claim released: still active, never notified — the next freed slot
    // retries instead of silently dropping the patient's offer.
    const after = await getPrisma().waitlistEntry.findUnique({
      where: { id: entry.id },
    });
    expect(after!.active).toBe(true);
    expect(after!.notifiedAt).toBeNull();
  });

  it("subscribeWaitlist notifies on emit and returns an unsubscribe", async () => {
    const service = await createService();
    const patient = await createPatient();
    const entry = await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.STAFF,
      },
    });

    const unsubscribe = subscribeWaitlist();
    try {
      // Production emit paths await the subscriber, so by the time this
      // resolves the entry must be consumed — no polling needed.
      await emitSlotFreedAsync(
        slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")),
      );
      const after = await getPrisma().waitlistEntry.findUnique({
        where: { id: entry.id },
      });
      expect(after!.active).toBe(false);
      expect(after!.notifiedAt).toBeInstanceOf(Date);
    } finally {
      unsubscribe();
    }

    // After unsubscribe, emits are ignored.
    const patient2 = await createPatient();
    await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient2.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.STAFF,
      },
    });
    await emitSlotFreedAsync(slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z")));
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST },
      }),
    ).toBe(1);
  });

  it("notifies exactly once when two frees race on the same watched date", async () => {
    const service = await createService();
    const patient = await createPatient();
    await getPrisma().waitlistEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        preferredDates: [utcMidnight("2026-09-02")],
        source: WaitlistSource.STAFF,
      },
    });
    const event = slotEvent(service.id, new Date("2026-09-02T10:00:00.000Z"));

    // Two concurrent frees (e.g. two cancellations on the same watched day):
    // the conditional consume lets exactly one winner through.
    const [a, b] = await Promise.all([handleSlotFreed(event), handleSlotFreed(event)]);
    expect(a + b).toBe(1);
    expect(
      await getPrisma().smsMessage.count({
        where: { type: SmsMessageType.WAITLIST },
      }),
    ).toBe(1);
  });
});
