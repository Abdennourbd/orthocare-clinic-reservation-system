import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { APPOINTMENTS_READ_RATE_LIMIT } from "@/lib/booking/rateLimits";
import { appointmentRangeQuerySchema } from "@/schemas/appointment";
import { getClinicDayBoundsUTC } from "@/lib/time/clinicTime";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Dashboard week strip — GET /api/admin/appointments/range?from=&to=&status=.
//
// One audited read for the whole Sat→Thu clinic week (the dashboard's most
// opened screen). Fetching the 6 day-views one by one would cost 6 audits +
// 6 rate-limit draws; the range costs 1 + 1 with the identical row shape.
//
// Load-bearing handler order (same as the day view): requireStaff ->
// rate limit -> Zod -> range checks -> DB read -> audit. A 404/400 must
// NEVER precede a 401/403. No CSRF on GET. Reads share the appointments-read
// pool (one pool per staff session).

const appointmentRowSelect = {
  id: true,
  startTime: true,
  endTime: true,
  status: true,
  source: true,
  patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
} as const;

const MAX_RANGE_DAYS = 31;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(
      `staff:${guard.user.id}:appointments-read`,
      APPOINTMENTS_READ_RATE_LIMIT,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = appointmentRangeQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { from, to, status } = parsedQuery.data;

  if (from > to) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "La date de début doit précéder la date de fin.",
    );
  }
  const { startUTC: fromStart } = getClinicDayBoundsUTC(from);
  const { endUTC: toEnd } = getClinicDayBoundsUTC(to);
  if ((toEnd.getTime() - fromStart.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
    return errorResponse(400, "VALIDATION_ERROR", "La période est limitée à 31 jours.");
  }

  const appointments = await getPrisma().appointment.findMany({
    where: {
      startTime: { gte: fromStart, lte: toEnd },
      ...(status ? { status } : {}),
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    take: 500, // safety cap
    select: appointmentRowSelect,
  });

  const resultTruncated = appointments.length === 500;

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Appointment",
    "list",
    // Dates + counter + optional enum only — never a patient name/phone.
    { scope: "range-view", from, to, resultCount: appointments.length, resultTruncated, ...(status ? { status } : {}) },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ from, to, resultTruncated, appointments }), guard);
}
