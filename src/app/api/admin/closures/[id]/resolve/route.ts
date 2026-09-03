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
import { CLOSURES_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { closureResolveSchema } from "@/schemas/closures";
import { releaseSlot } from "@/lib/booking/releaseSlot";
import { runSideEffect } from "@/lib/booking/runSideEffect";
import { sendAppointmentCancelled } from "@/lib/messaging/appointmentChanges";
import { appointmentOverlapsClosure } from "@/lib/closures/window";
import {
  AppointmentAlreadyReleasedError,
  AppointmentNotFoundError,
} from "@/lib/booking/errors";
import {
  AuditAction,
  AuditActorType,
  AppointmentStatus,
  CancelReason,
} from "@/generated/prisma/client";

// Task 21 — POST /api/admin/closures/[id]/resolve. ADMIN-only.
//
// The staff decision after POST /closures returned an affected list.
// Two explicit actions, never a silent drop:
//
// - `cancel_and_notify`: releaseSlot(id, CLOSURE) per appointment (fires the
//   slot-freed event so the waitlist stays consistent) + cancelled SMS via
//   the existing sender (failures swallowed — messaging never fails the
//   status change, same discipline as the staff cancel route). Per-id
//   results so a partial failure never aborts the rest.
// - `keep_for_call`: appointments untouched (staff will phone to reschedule);
//   the closure still blocks new bookings.
//
// Order is load-bearing: requireStaff -> CSRF -> rate limit -> Zod -> domain
// checks (404 closure) -> DB writes. A 400/404 must NEVER precede a 401/403.
//
// `appointmentIds` must cover every still-active overlapping appointment
// unless `acknowledgedUnresolved: true` is set explicitly. Ids outside the
// closure's overlapping set are rejected as OUT_OF_SCOPE (never cancelled
// under a misleading CLOSURE reason). The per-appointment audit row is
// written only when the cancel actually succeeded.

type Ctx = { params: Promise<Record<string, string>> };

export async function POST(request: NextRequest, context: Ctx) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:closures-write`, CLOSURES_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = closureResolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { action, appointmentIds, acknowledgedUnresolved } = parsed.data;

  const { id } = await context.params;
  const closure = await getPrisma().scheduleException.findUnique({ where: { id } });
  if (!closure) {
    return errorResponse(404, "NOT_FOUND", "Fermeture introuvable.");
  }

  // Recompute the still-active overlapping set (appointments may have been
  // confirmed/cancelled between the POST /closures preview and this call).
  // Same two-level narrowing as the create route: UTC range in the DB, then
  // the HH:MM window in TypeScript for partial-day closures.
  const candidates = await getPrisma().appointment.findMany({
    where: {
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      startTime: { lt: closure.endDate },
      endTime: { gt: closure.startDate },
      ...(closure.serviceId ? { serviceId: closure.serviceId } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });
  const overlapping = candidates.filter((a) =>
    appointmentOverlapsClosure(
      { startTime: a.startTime, endTime: a.endTime },
      {
        startDate: closure.startDate,
        endDate: closure.endDate,
        allDay: closure.allDay,
        startTime: closure.startTime,
        endTime: closure.endTime,
      },
    ),
  );
  const overlappingIds = new Set(overlapping.map((a) => a.id));
  const unresolved = [...overlappingIds].filter((oid) => !appointmentIds.includes(oid));
  if (unresolved.length > 0 && !acknowledgedUnresolved) {
    return errorResponse(
      409,
      "UNRESOLVED_REMAINING",
      `${unresolved.length} rendez-vous restent sans décision. Confirmez pour continuer.`,
    );
  }

  if (action === "keep_for_call") {
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.SETTINGS_UPDATED,
      "ScheduleException",
      id,
      { action, keptCount: appointmentIds.length, unresolvedCount: unresolved.length },
      getClientIp(request.headers),
    );
    return withRefreshedSession(
      ok({ action, kept: appointmentIds, unresolved }),
      guard,
    );
  }

  // cancel_and_notify — per-id results, never abort on a single failure.
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const appointmentId of appointmentIds) {
    if (!overlappingIds.has(appointmentId)) {
      // Outside this closure's window — refuse rather than cancel under a
      // misleading CLOSURE reason (the admin already has the direct cancel
      // route for deliberate out-of-scope cancels).
      failed.push({ id: appointmentId, reason: "OUT_OF_SCOPE" });
      continue;
    }
    try {
      await releaseSlot(appointmentId, CancelReason.CLOSURE);
      await runSideEffect(() => sendAppointmentCancelled(appointmentId));
      succeeded.push(appointmentId);
      await logAction(
        { type: AuditActorType.STAFF, userId: guard.user.id },
        AuditAction.APPOINTMENT_CANCELLED,
        "Appointment",
        appointmentId,
        { closureId: id, cancelReason: "CLOSURE" },
        getClientIp(request.headers),
      );
    } catch (e) {
      if (e instanceof AppointmentNotFoundError) {
        failed.push({ id: appointmentId, reason: "NOT_FOUND" });
      } else if (e instanceof AppointmentAlreadyReleasedError) {
        failed.push({ id: appointmentId, reason: "ALREADY_RELEASED" });
      } else {
        throw e;
      }
    }
  }

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "ScheduleException",
    id,
    {
      action,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      unresolvedCount: unresolved.length,
    },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ action, succeeded, failed, unresolved }), guard);
}
