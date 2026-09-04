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
import {
  CLOSURES_READ_RATE_LIMIT,
  CLOSURES_WRITE_RATE_LIMIT,
} from "@/lib/content/rateLimits";
import { closureCreateSchema } from "@/schemas/closures";
import { getClinicDayBoundsUTC, toClinicLocalDateString } from "@/lib/time/clinicTime";
import { appointmentOverlapsClosure } from "@/lib/closures/window";
import { AuditAction, AuditActorType, AppointmentStatus } from "@/generated/prisma/client";

// Task 21 — GET (list upcoming) + POST (create, returns affected list) for
// /api/admin/closures. ADMIN-only.
//
// Two-phase by design (plan.md: "never dropped silently"): POST creates the
// closure (which blocks new bookings immediately — the engine reads
// exceptions live) and returns the overlapping PENDING/CONFIRMED
// appointments WITHOUT touching them. The staff decision (bulk
// cancel-and-notify or keep-for-call) goes through POST /[id]/resolve.

const closureRowSelect = {
  id: true,
  startDate: true,
  endDate: true,
  allDay: true,
  startTime: true,
  endTime: true,
  reason: true,
  serviceId: true,
  createdAt: true,
  service: { select: { id: true, slug: true, name: true } },
} as const;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:closures-read`, CLOSURES_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  // Bounded list: expired closures fall out of the window (history lives in
  // the audit trail), and `take` caps the payload if the table ever grows.
  const { startUTC: todayStartUTC } = getClinicDayBoundsUTC(
    toClinicLocalDateString(new Date()),
  );
  const closures = await getPrisma().scheduleException.findMany({
    where: { endDate: { gte: todayStartUTC } },
    orderBy: { startDate: "asc" },
    take: 200,
    select: closureRowSelect,
  });

  return withRefreshedSession(ok({ closures }), guard);
}

export async function POST(request: NextRequest) {
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

  const parsed = closureCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { startDate, endDate, allDay, startTime, endTime, reason, serviceId } = parsed.data;

  if (serviceId) {
    const service = await getPrisma().service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!service) {
      return errorResponse(404, "NOT_FOUND", "Service introuvable.");
    }
  }

  // Clinic-local days → UTC bounds (same convention as the waitlist:
  // Africa/Algiers has no DST, mapping via clinicTime is stable).
  const startUTC = getClinicDayBoundsUTC(startDate).startUTC;
  const endUTC = getClinicDayBoundsUTC(endDate).endUTC;

  const closure = await getPrisma().scheduleException.create({
    data: {
      startDate: startUTC,
      endDate: endUTC,
      allDay,
      startTime: allDay ? null : (startTime ?? null),
      endTime: allDay ? null : (endTime ?? null),
      reason: reason as object,
      serviceId: serviceId ?? null,
      createdById: guard.user.id,
    },
    select: closureRowSelect,
  });

  // Affected = active appointments overlapping the closure window. Scoped to
  // the closure's service when set, whole clinic otherwise. The DB query
  // narrows by UTC range; a partial-day closure then narrows further by its
  // HH:MM window in TypeScript (same math as the slot engine — a 13:00–14:00
  // closure must not list the whole day's bookings).
  const candidates = await getPrisma().appointment.findMany({
    where: {
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      startTime: { lt: endUTC },
      endTime: { gt: startUTC },
      ...(serviceId ? { serviceId } : {}),
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      service: { select: { id: true, slug: true, name: true } },
      patient: {
        select: { id: true, firstName: true, lastName: true, phoneE164: true },
      },
    },
  });
  const affected = candidates.filter((a) =>
    appointmentOverlapsClosure(
      { startTime: a.startTime, endTime: a.endTime },
      {
        startDate: startUTC,
        endDate: endUTC,
        allDay,
        startTime: allDay ? null : (startTime ?? null),
        endTime: allDay ? null : (endTime ?? null),
      },
    ),
  );

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.CLOSURE_CREATED,
    "ScheduleException",
    closure.id,
    // Dates + count only — never patient names/phones.
    { startDate, endDate, allDay, affectedCount: affected.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(
    ok({ closure, affectedCount: affected.length, affected }, { status: 201 }),
    guard,
  );
}
