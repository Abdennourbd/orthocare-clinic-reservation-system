import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  type Patient,
  type Prisma,
  type SelfServiceToken,
  type Service,
} from "@/generated/prisma/client";
import {
  AppointmentNotActiveError,
  AppointmentNotConfirmedError,
  SelfServiceTokenExpiredError,
  SelfServiceTokenNotFoundError,
  SelfServiceTokenRevokedError,
  SelfServiceTokenUsedError,
} from "./errors";

export {
  AppointmentNotActiveError,
  AppointmentNotConfirmedError,
  SelfServiceTokenExpiredError,
  SelfServiceTokenNotFoundError,
  SelfServiceTokenRevokedError,
  SelfServiceTokenUsedError,
} from "./errors";

/**
 * Capability URL tokens (plan.md §Self-service link). The raw token is a
 * high-entropy random value (256 bits) that is returned to the caller exactly
 * once — to build the SMS link — and ONLY its SHA-256 hash is stored. Because
 * the token is unguessable, the hash is safe from offline brute force; the
 * table gives revocation + single-use replay protection a stateless signed
 * token cannot.
 */

/** A token never outlives the appointment by more than this (plan.md: "Expiry
 * ≤ 48h after the appointment"). */
export const TOKEN_EXPIRY_AFTER_APPOINTMENT_MS = 48 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

/** SHA-256 of a raw token — the only representation stored in the DB. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

type VerifiedAppointment = Prisma.AppointmentGetPayload<{
  include: { patient: true; service: true };
}>;

export type VerifiedSelfServiceToken = {
  token: SelfServiceToken;
  appointment: VerifiedAppointment;
  patient: Patient;
  service: Service;
};

/**
 * Issue a self-service token for a confirmed appointment.
 *
 * Requires the appointment to be CONFIRMED (the token lives in the
 * confirmation SMS). This function does NOT rotate/revoke any existing token —
 * rotation is the reschedule flow's responsibility (`selfServiceReschedule`
 * explicitly revokes the old token), and auto-revoking here would break
 * concurrent confirmations: two overlapping confirmation requests each revoke
 * the other's token, so the SMS could carry a link that is already revoked.
 * A second token for the same appointment is harmless (an equivalent,
 * unknown-to-anyone capability).
 *
 * Returns the raw token (never stored) so the caller can build the SMS link.
 */
export async function createSelfServiceToken(
  appointmentId: string,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(rawToken);

  return getPrisma().$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) {
      throw new AppointmentNotConfirmedError();
    }
    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new AppointmentNotConfirmedError();
    }

    const expiresAt = new Date(
      appointment.endTime.getTime() + TOKEN_EXPIRY_AFTER_APPOINTMENT_MS,
    );

    await tx.selfServiceToken.create({
      data: { tokenHash, appointmentId, expiresAt },
    });

    return { rawToken, expiresAt };
  });
}

/**
 * Resolve a raw token to its appointment, patient and service — or reject.
 *
 * Rejection order (all typed errors): not found → used → revoked → expired →
 * appointment no longer active. Used/revoked/expired all map to HTTP 410, so
 * the route surface is tiny; the distinctions matter for the audit trail and
 * the negative-test matrix.
 */
export async function verifySelfServiceToken(
  rawToken: string,
): Promise<VerifiedSelfServiceToken> {
  const tokenHash = hashToken(rawToken);
  const token = await getPrisma().selfServiceToken.findUnique({
    where: { tokenHash },
    include: {
      appointment: { include: { patient: true, service: true } },
    },
  });

  if (!token) throw new SelfServiceTokenNotFoundError();
  if (token.usedAt) throw new SelfServiceTokenUsedError();
  if (token.revokedAt) throw new SelfServiceTokenRevokedError();
  if (token.expiresAt.getTime() < Date.now()) {
    throw new SelfServiceTokenExpiredError();
  }

  const appointment = token.appointment;
  const active: AppointmentStatus[] = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
  ];
  if (!active.includes(appointment.status)) {
    throw new AppointmentNotActiveError();
  }

  return {
    token,
    appointment,
    patient: appointment.patient,
    service: appointment.service,
  };
}

/** Revoke a token (used by rotation and any staff revocation path). */
export async function revokeSelfServiceToken(
  tokenId: string,
): Promise<void> {
  await getPrisma().selfServiceToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
}