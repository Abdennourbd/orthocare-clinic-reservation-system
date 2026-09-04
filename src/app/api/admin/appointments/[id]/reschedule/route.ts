import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { rescheduleSlot } from "@/lib/booking/rescheduleSlot";
import { runSideEffect } from "@/lib/booking/runSideEffect";
import {
  SlotConflictError,
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "@/lib/booking/errors";
import { APPOINTMENTS_WRITE_RATE_LIMIT } from "@/lib/booking/rateLimits";
import { appointmentRescheduleSchema } from "@/schemas/appointment";
import { sendAppointmentRescheduled } from "@/lib/messaging/appointmentChanges";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  CancelReason,
} from "@/generated/prisma/client";

// Task 14 step 2 — POST /api/admin/appointments/[id]/reschedule: staff moves
// an appointment. The old slot is released (RESCHEDULED, reason STAFF) and the
// new one is booked CONFIRMED — all inside rescheduleSlot()'s single
// transaction, whose bookSlotInTx re-checks availability (working hours, lead
// time, horizon, overlap, closures) under the per-day advisory lock. That is
// the "reschedule re-checks slot availability" acceptance criterion: no
// separate availability endpoint is consulted, the check is inherent.
//
// A staff-rescheduled appointment stays CONFIRMED (the patient was already
// managed — no new confirmation call), matching the self-service reschedule
// precedent (src/lib/selfservice/actions.ts).
//
// Order is load-bearing: requireStaff -> CSRF -> rate limit -> Zod -> domain
// checks (404 / 409) -> DB write. A 404 must NEVER precede a 401/403.
// Messaging failures never propagate (sendAppointmentRescheduled is wrapped
// in runSideEffect()).

export async function POST(
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

  const parsed = appointmentRescheduleSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const newStartUTC = new Date(parsed.data.startTime);
  if (Number.isNaN(newStartUTC.getTime())) {
    return errorResponse(400, "VALIDATION_ERROR", "Nouvelle date/heure invalide.");
  }

  // resourceId is a v2-reserved column (no Resource table exists yet): a
  // non-null value would be persisted as a dangling reference and only salt
  // the advisory lock. Rejected before any write; omitted/null means "keep
  // the current chair" (always null in v1).
  if (parsed.data.resourceId != null) {
    return errorResponse(
      400,
      "RESOURCE_UNSUPPORTED",
      "Les ressources multi-chaises ne sont pas encore prises en charge.",
    );
  }

  const { id } = await params;

  // Read the current resourceId BEFORE the transaction: rescheduleSlot() books
  // the new appointment with the resourceId it is given, and an omitted value
  // must mean "keep the same chair", not "reset to no chair". Also gives the
  // canonical 404 before any domain error mapping.
  const existing = await getPrisma().appointment.findUnique({
    where: { id },
    select: { id: true, resourceId: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Rendez-vous introuvable.");
  }

  let result;
  try {
    result = await rescheduleSlot({
      appointmentId: id,
      newStartUTC,
      reason: CancelReason.STAFF,
      // Staff-rescheduled appointments stay CONFIRMED — already managed, no
      // re-confirmation call needed.
      newStatus: AppointmentStatus.CONFIRMED,
      resourceId: parsed.data.resourceId ?? existing.resourceId,
    });
  } catch (e) {
    if (e instanceof AppointmentNotFoundError) {
      return errorResponse(404, "NOT_FOUND", "Rendez-vous introuvable.");
    }
    if (e instanceof AppointmentAlreadyReleasedError) {
      // A concurrent cancel/reschedule/expiry won the race.
      return errorResponse(
        409,
        "APPOINTMENT_NOT_ACTIVE",
        "Ce rendez-vous n'est plus actif.",
      );
    }
    if (e instanceof SlotConflictError) {
      return errorResponse(409, "SLOT_CONFLICT", "Ce créneau n'est pas disponible.");
    }
    throw e;
  }

  // SMS carrying the ROTATED self-service link for the NEW appointment,
  // keyed to the OLD appointmentId — after commit, failures swallowed.
  await runSideEffect(() =>
    sendAppointmentRescheduled(result.oldAppointment.id, result.newAppointment.id),
  );

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.APPOINTMENT_RESCHEDULED,
    "Appointment",
    id,
    // Ids, enum and slot instants only (the self-service reschedule audit
    // already records start times — they are not patient-identifying).
    // Never a patient name or phone.
    {
      newAppointmentId: result.newAppointment.id,
      cancelReason: CancelReason.STAFF,
      oldStart: result.oldAppointment.startTime.toISOString(),
      newStart: result.newAppointment.startTime.toISOString(),
    },
    getClientIp(request.headers),
  );

  // Named fields only, never a model spread.
  return withRefreshedSession(
    ok({
      oldAppointment: {
        id: result.oldAppointment.id,
        status: result.oldAppointment.status,
        cancelReason: result.oldAppointment.cancelReason,
        startTime: result.oldAppointment.startTime.toISOString(),
      },
      newAppointment: {
        id: result.newAppointment.id,
        status: result.newAppointment.status,
        startTime: result.newAppointment.startTime.toISOString(),
        endTime: result.newAppointment.endTime.toISOString(),
      },
    }),
    guard,
  );
}
