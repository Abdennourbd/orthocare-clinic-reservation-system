import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { AppointmentStatus } from "@/generated/prisma/client";
import {
  createSelfServiceToken,
  verifySelfServiceToken,
  revokeSelfServiceToken,
  hashToken,
  TOKEN_EXPIRY_AFTER_APPOINTMENT_MS,
} from "./tokens";
import {
  SelfServiceTokenNotFoundError,
  SelfServiceTokenUsedError,
  SelfServiceTokenRevokedError,
  SelfServiceTokenExpiredError,
  AppointmentNotActiveError,
  AppointmentNotConfirmedError,
} from "./errors";

let patientId: string;
let serviceId: string;

const localStart = (localDate: string, hhmm: string): Date =>
  new Date(`${localDate}T${hhmm}:00.000+01:00`);

beforeEach(async () => {
  const prisma = getPrisma();
  const patient = await prisma.patient.create({
    data: {
      firstName: "Yasmine",
      lastName: "Khelifi",
      phone: "0551122334",
      phoneE164: "+213551122334",
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
});

async function makeAppointment(status: AppointmentStatus = AppointmentStatus.CONFIRMED) {
  return getPrisma().appointment.create({
    data: {
      patientId,
      serviceId,
      startTime: localStart("2026-09-10", "11:00"),
      endTime: localStart("2026-09-10", "11:30"),
      status,
    },
  });
}

describe("createSelfServiceToken", () => {
  it("returns a raw token and stores ONLY its SHA-256 hash", async () => {
    const appointment = await makeAppointment();

    const { rawToken } = await createSelfServiceToken(appointment.id);

    expect(rawToken.length).toBeGreaterThanOrEqual(32);

    const rows = await getPrisma().selfServiceToken.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(rawToken));
    // The raw token itself must never appear in the row.
    expect(rows[0].tokenHash).not.toContain(rawToken);
    expect(rows[0].usedAt).toBeNull();
    expect(rows[0].revokedAt).toBeNull();
  });

  it("expires at most 48h after the appointment's end time", async () => {
    const appointment = await makeAppointment();

    const { expiresAt } = await createSelfServiceToken(appointment.id);

    expect(expiresAt.getTime()).toBe(
      appointment.endTime.getTime() + TOKEN_EXPIRY_AFTER_APPOINTMENT_MS,
    );
  });

  it("rejects an appointment that is not CONFIRMED", async () => {
    const appointment = await makeAppointment(AppointmentStatus.PENDING);

    await expect(createSelfServiceToken(appointment.id)).rejects.toThrow(
      AppointmentNotConfirmedError,
    );
  });

  it("rotates: issuing a second token revokes the first (one live token per appointment)", async () => {
    const appointment = await makeAppointment();

    const first = await createSelfServiceToken(appointment.id);
    const second = await createSelfServiceToken(appointment.id);

    // The first token is now revoked; the second is live.
    await expect(verifySelfServiceToken(first.rawToken)).rejects.toThrow(
      SelfServiceTokenRevokedError,
    );
    const verified = await verifySelfServiceToken(second.rawToken);
    expect(verified.appointment.id).toBe(appointment.id);

    const rows = await getPrisma().selfServiceToken.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt).length).toBe(1);
  });
});

describe("verifySelfServiceToken", () => {
  it("returns the appointment, patient and service for a valid token", async () => {
    const appointment = await makeAppointment();
    const { rawToken } = await createSelfServiceToken(appointment.id);

    const verified = await verifySelfServiceToken(rawToken);

    expect(verified.appointment.id).toBe(appointment.id);
    expect(verified.appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(verified.patient.id).toBe(patientId);
    expect(verified.patient.firstName).toBe("Yasmine");
    expect(verified.service.id).toBe(serviceId);
  });

  it("rejects an unknown token", async () => {
    await expect(verifySelfServiceToken("does-not-exist")).rejects.toThrow(
      SelfServiceTokenNotFoundError,
    );
  });

  it("rejects a token that was already used (single-use cancel)", async () => {
    const appointment = await makeAppointment();
    const { rawToken } = await createSelfServiceToken(appointment.id);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId: appointment.id },
      data: { usedAt: new Date() },
    });

    await expect(verifySelfServiceToken(rawToken)).rejects.toThrow(
      SelfServiceTokenUsedError,
    );
  });

  it("rejects a revoked token", async () => {
    const appointment = await makeAppointment();
    const { rawToken } = await createSelfServiceToken(appointment.id);
    const row = await getPrisma().selfServiceToken.findFirstOrThrow({
      where: { appointmentId: appointment.id },
    });
    await revokeSelfServiceToken(row.id);

    await expect(verifySelfServiceToken(rawToken)).rejects.toThrow(
      SelfServiceTokenRevokedError,
    );
  });

  it("rejects an expired token", async () => {
    const appointment = await makeAppointment();
    const { rawToken } = await createSelfServiceToken(appointment.id);
    await getPrisma().selfServiceToken.updateMany({
      where: { appointmentId: appointment.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(verifySelfServiceToken(rawToken)).rejects.toThrow(
      SelfServiceTokenExpiredError,
    );
  });

  it("rejects a token whose appointment is no longer active (cancelled)", async () => {
    const appointment = await makeAppointment();
    const { rawToken } = await createSelfServiceToken(appointment.id);
    await getPrisma().appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.CANCELLED },
    });

    await expect(verifySelfServiceToken(rawToken)).rejects.toThrow(
      AppointmentNotActiveError,
    );
  });
});