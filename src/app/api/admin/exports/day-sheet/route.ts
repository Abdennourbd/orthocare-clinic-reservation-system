import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logAction } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { EXPORTS_RATE_LIMIT } from "@/lib/exports/rateLimits";
import { getClinicDayBoundsUTC } from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import { daySheetQuerySchema } from "@/schemas/exports";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 19 — GET /api/admin/exports/day-sheet?date=YYYY-MM-DD. Printable day
// schedule (paper fallback if the site is unreachable during clinic hours):
// the day's appointments ordered by start time with the fields the front desk
// needs on paper — time, patient, phone, service, status. ADMIN-only and
// audited as EXPORT_GENERATED with the row count (same bulk-extract ruling as
// the monthly export). The UI at /admin/exports renders this as the printable
// sheet (print CSS keeps it to one page). Named-field selects only.
//
// Load-bearing handler order: requireStaff -> rate limit -> Zod -> read ->
// audit. A 400 must NEVER precede a 401/403. No CSRF on GET.

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(
      `staff:${guard.user.id}:exports-read`,
      EXPORTS_RATE_LIMIT,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = daySheetQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { date } = parsedQuery.data;

  // Day bounds are clinic-local (Africa/Algiers), never the server's day.
  const { startUTC, endUTC } = getClinicDayBoundsUTC(date);

  const appointments = await getPrisma().appointment.findMany({
    where: { startTime: { gte: startUTC, lte: endUTC } },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      source: true,
      patient: {
        select: { firstName: true, lastName: true, phone: true, phoneE164: true },
      },
      service: { select: { name: true, durationMinutes: true } },
    },
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.EXPORT_GENERATED,
    "Appointment",
    date,
    // Date + count only — never a patient name/phone.
    { scope: "day-sheet", date, rowCount: appointments.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(
    ok({
      date,
      appointments: appointments.map((a) => ({
        id: a.id,
        startTime: a.startTime,
        endTime: a.endTime,
        status: a.status,
        source: a.source,
        patientFirstName: a.patient.firstName,
        patientLastName: a.patient.lastName,
        patientPhone: a.patient.phoneE164 || a.patient.phone,
        serviceName: localized(a.service.name as never, "fr"),
        serviceDurationMinutes: a.service.durationMinutes,
      })),
    }),
    guard,
  );
}
