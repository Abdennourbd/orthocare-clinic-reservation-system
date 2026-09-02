import { describe, it, expect, beforeEach } from "vitest";
import { AppointmentStatus } from "@/generated/prisma/client";
import {
  splitAudience,
  type AppointmentWithPatient,
  type BroadcastExclusionReason,
} from "./smsCenter";

// Pure unit test for the Task 16 broadcast audience split — no DB, no mocks,
// the function is pure by design (same convention as adminTransitions.test.ts).

let sequence = 0;

beforeEach(() => {
  // Deterministic fixture ids (appt-1, appt-2, …) within each test.
  sequence = 0;
});

function appointment(
  overrides: {
    status?: AppointmentStatus;
    patient?: Partial<AppointmentWithPatient["patient"]>;
  } = {},
): AppointmentWithPatient {
  sequence++;
  return {
    id: `appt-${sequence}`,
    status: overrides.status ?? AppointmentStatus.PENDING,
    startTime: new Date(`2026-09-02T0${sequence % 10}:00:00.000Z`),
    patient: {
      id: `patient-${sequence}`,
      firstName: "Amina",
      lastName: "Benali",
      phoneE164: `+2136120000${String(sequence).padStart(2, "0")}`,
      active: true,
      messagingOptOut: false,
      anonymizedAt: null,
      ...overrides.patient,
    },
  };
}

describe("splitAudience", () => {
  it("treats PENDING and CONFIRMED as recipients with the patient fields resolved", () => {
    const audience = splitAudience([
      appointment({ status: AppointmentStatus.PENDING }),
      appointment({ status: AppointmentStatus.CONFIRMED }),
    ]);
    expect(audience.excluded).toEqual([]);
    expect(audience.recipients).toHaveLength(2);
    expect(audience.recipients[0]).toEqual({
      appointmentId: "appt-1",
      patientId: "patient-1",
      firstName: "Amina",
      lastName: "Benali",
      phone: "+213612000001",
      startTime: audience.recipients[0].startTime,
    });
  });

  it.each([
    [AppointmentStatus.CANCELLED, "CANCELLED"],
    [AppointmentStatus.RESCHEDULED, "RESCHEDULED"],
    [AppointmentStatus.COMPLETED, "COMPLETED"],
    [AppointmentStatus.NO_SHOW, "NO_SHOW"],
  ] as const)(
    "excludes %s appointments with reason %s",
    (status, reason: BroadcastExclusionReason) => {
      const audience = splitAudience([appointment({ status })]);
      expect(audience.recipients).toEqual([]);
      expect(audience.excluded).toEqual([{ appointmentId: "appt-1", reason }]);
    },
  );

  it("excludes an opted-out patient with reason OPTED_OUT before the inactive check", () => {
    const audience = splitAudience([
      appointment({ patient: { messagingOptOut: true, active: false } }),
    ]);
    expect(audience.recipients).toEqual([]);
    expect(audience.excluded).toEqual([
      { appointmentId: "appt-1", reason: "OPTED_OUT" },
    ]);
  });

  it("excludes an inactive (soft-deleted) patient with reason INACTIVE", () => {
    const audience = splitAudience([
      appointment({ patient: { active: false } }),
    ]);
    expect(audience.recipients).toEqual([]);
    expect(audience.excluded).toEqual([
      { appointmentId: "appt-1", reason: "INACTIVE" },
    ]);
  });

  it("excludes an anonymized patient with reason INACTIVE", () => {
    const audience = splitAudience([
      appointment({ patient: { anonymizedAt: new Date("2026-08-01T00:00:00Z") } }),
    ]);
    expect(audience.recipients).toEqual([]);
    expect(audience.excluded).toEqual([
      { appointmentId: "appt-1", reason: "INACTIVE" },
    ]);
  });

  it("classifies every appointment exactly once and preserves input order in both lists", () => {
    const appointments = [
      appointment({ status: AppointmentStatus.CONFIRMED }), // recipient 1
      appointment({ status: AppointmentStatus.CANCELLED }), // excluded 2
      appointment({ patient: { messagingOptOut: true } }), // excluded 3
      appointment({ status: AppointmentStatus.PENDING }), // recipient 4
      appointment({ patient: { active: false } }), // excluded 5
      appointment({ status: AppointmentStatus.RESCHEDULED }), // excluded 6
      appointment({ status: AppointmentStatus.NO_SHOW }), // excluded 7
      appointment({ patient: { anonymizedAt: new Date() } }), // excluded 8
      appointment({ status: AppointmentStatus.COMPLETED }), // excluded 9
    ];
    const audience = splitAudience(appointments);

    expect(audience.recipients.map((r) => r.appointmentId)).toEqual([
      "appt-1",
      "appt-4",
    ]);
    expect(audience.excluded).toEqual([
      { appointmentId: "appt-2", reason: "CANCELLED" },
      { appointmentId: "appt-3", reason: "OPTED_OUT" },
      { appointmentId: "appt-5", reason: "INACTIVE" },
      { appointmentId: "appt-6", reason: "RESCHEDULED" },
      { appointmentId: "appt-7", reason: "NO_SHOW" },
      { appointmentId: "appt-8", reason: "INACTIVE" },
      { appointmentId: "appt-9", reason: "COMPLETED" },
    ]);
  });

  it("returns an empty audience for an empty day", () => {
    expect(splitAudience([])).toEqual({ recipients: [], excluded: [] });
  });
});
