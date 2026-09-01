import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { logAction } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { releaseSlot } from "@/lib/booking/releaseSlot";
import {
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "@/lib/booking/errors";
import {
  getAdminTransition,
  type AdminStatusAction,
  type SmsSenderName,
} from "@/lib/booking/adminTransitions";
import {
  APPOINTMENTS_READ_RATE_LIMIT,
  APPOINTMENTS_WRITE_RATE_LIMIT,
} from "@/lib/booking/rateLimits";
import { appointmentStatusChangeSchema } from "@/schemas/appointment";
import {
  sendAppointmentCancelled,
  sendAppointmentConfirmation,
} from "@/lib/messaging/appointmentChanges";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
  type Prisma,
} from "@/generated/prisma/client";

// Task 14 step 2 — GET (detail) + PATCH (staff status change) for
// /api/admin/appointments/[id]. Both staff roles, explicitly (never a bare
// requireStaff — a role added later must fail closed).
//
// Order is load-bearing in every handler: requireStaff -> (CSRF, on PATCH) ->
// rate limit -> Zod -> domain checks (404 / 409 not-active) -> DB write.
// A 404 must NEVER precede a 401/403 — that is what would let an anonymous
// caller learn "this appointment id exists" from a status code alone.
//
// The status-change semantics (which status, which timestamp, which audit
// action, which SMS, which cancel reason) live in ONE place:
// STATUS_TRANSITIONS (src/lib/booking/adminTransitions.ts) — shared with the
// integration tests. This file only orchestrates guards, reads, writes and
// side effects.
//
// Messaging failures never propagate: a failed SMS must not fail the status
// change it accompanies (same `safe()` discipline as the self-service
// actions, src/lib/selfservice/actions.ts).
//
// Next 16: `params` is a Promise — awaited before use.

// Named fields only, never a model spread (spread leaks non-column keys and
// can serialize PII in a PrismaClientValidationError).
const appointmentDetailSelect = {
  id: true,
  startTime: true,
  endTime: true,
  status: true,
  source: true,
  resourceId: true,
  cancelReason: true,
  confirmedAt: true,
  cancelledAt: true,
  completedAt: true,
  noShowAt: true,
  createdAt: true,
  patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
} satisfies Prisma.AppointmentSelect;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:appointments-read`, APPOINTMENTS_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await params;

  const appointment = await getPrisma().appointment.findUnique({
    where: { id },
    select: appointmentDetailSelect,
  });
  if (!appointment) {
    return errorResponse(404, "NOT_FOUND", "Rendez-vous introuvable.");
  }

  // A single appointment exposes a patient's identity (name + phone) —
  // audited like every other read of patient-identifying data in this route
  // family. Detail is a scope label only.
  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Appointment",
    id,
    { scope: "record" },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(appointment), guard);
}

/** Run a side effect, swallowing failures so the status change always wins. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error("appointment side effect failed", e);
    return null;
  }
}

// The senders, resolved by the stable NAME carried in STATUS_TRANSITIONS
// (the transition map stays pure — no messaging imports — so the unit test
// can read it without a database).
const SMS_SENDERS: Record<
  SmsSenderName,
  (appointmentId: string) => Promise<unknown>
> = {
  sendAppointmentConfirmation: sendAppointmentConfirmation,
  sendAppointmentCancelled: sendAppointmentCancelled,
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:appointments-write`, APPOINTMENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = appointmentStatusChangeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const action: AdminStatusAction = parsed.data.action;
  const transition = getAdminTransition(action);

  const { id } = await params;

  const existing = await getPrisma().appointment.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Rendez-vous introuvable.");
  }

  // Domain gate: every staff action targets an ACTIVE appointment. Once
  // CANCELLED/RESCHEDULED/COMPLETED/NO_SHOW, there is nothing left to
  // confirm, cancel, complete or mark no-show — 409, not 404 (the row exists;
  // the operation is the conflict). The one exception: CONFIRM on an already
  // CONFIRMED appointment is an idempotent no-op (a double-click, a retry) —
  // the state is already the requested one, so succeed without rewriting,
  // without re-messaging and without a duplicate audit row.
  const activeStatuses: AppointmentStatus[] = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
  ];
  if (!activeStatuses.includes(existing.status)) {
    return errorResponse(
      409,
      "APPOINTMENT_NOT_ACTIVE",
      "Ce rendez-vous n'est plus actif.",
    );
  }
  if (action === "CONFIRM" && existing.status === AppointmentStatus.CONFIRMED) {
    const current = await getPrisma().appointment.findUnique({
      where: { id },
      select: appointmentDetailSelect,
    });
    return withRefreshedSession(ok(current), guard);
  }

  // Two write paths, chosen by the transition map (the single source of
  // truth). CANCEL frees the slot through the shared releaseSlot() so the
  // waitlist slot-freed event fires; everything else writes the new status +
  // its timestamp directly (COMPLETE/NO_SHOW keep the slot as-is).
  if (transition.releasesSlot) {
    try {
      // transition.cancelReason is non-null exactly when releasesSlot is
      // (CANCEL/STAFF — the map's single source of truth); the fallback only
      // satisfies the type.
      await releaseSlot(id, transition.cancelReason ?? CancelReason.STAFF);
    } catch (e) {
      // A concurrent cancel/reschedule/expiry already freed the slot.
      if (e instanceof AppointmentAlreadyReleasedError) {
        return errorResponse(
          409,
          "APPOINTMENT_NOT_ACTIVE",
          "Ce rendez-vous n'est plus actif.",
        );
      }
      if (e instanceof AppointmentNotFoundError) {
        return errorResponse(404, "NOT_FOUND", "Rendez-vous introuvable.");
      }
      throw e;
    }
  } else {
    // Named fields only, never a spread. confirmedAt additionally records
    // WHO confirmed (the confirm-after-call audit trail).
    const data: Prisma.AppointmentUncheckedUpdateInput = {
      status: transition.newStatus,
    };
    if (transition.timestampField === "confirmedAt") {
      data.confirmedAt = new Date();
      data.confirmedByUserId = guard.user.id;
    } else if (transition.timestampField === "completedAt") {
      data.completedAt = new Date();
    } else if (transition.timestampField === "noShowAt") {
      data.noShowAt = new Date();
    } else {
      // Unreachable via the transition map today (CANCEL releases the slot
      // instead) but keeps the if-chain exhaustive over timestampField.
      data.cancelledAt = new Date();
    }
    await getPrisma().appointment.update({ where: { id }, data });
  }

  // SMS after the commit, failures swallowed (never fails the status change).
  if (transition.smsSender) {
    const senderName: SmsSenderName = transition.smsSender;
    await safe(() => SMS_SENDERS[senderName](id));
  }

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    transition.auditAction,
    "Appointment",
    id,
    // Enums/ids only — never a patient name or phone.
    {
      action,
      ...(transition.cancelReason ? { cancelReason: transition.cancelReason } : {}),
    },
    getClientIp(request.headers),
  );

  // Re-read through the whitelist so both write paths answer with the exact
  // same named-field shape.
  const appointment = await getPrisma().appointment.findUnique({
    where: { id },
    select: appointmentDetailSelect,
  });

  return withRefreshedSession(ok(appointment), guard);
}
