import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logAction } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { EXPORTS_RATE_LIMIT } from "@/lib/exports/rateLimits";
import {
  buildExportRows,
  exportFileName,
  getClinicMonthBoundsUTC,
  toCSV,
  toXLSX,
} from "@/lib/exports/appointments";
import { appointmentsExportQuerySchema } from "@/schemas/exports";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 19 — GET /api/admin/exports/appointments?month=YYYY-MM&format=csv|xlsx
// (&includeNotes=true to opt into the clinical-notes column). Monthly activity
// report, ADMIN-only: an export is a bulk extract of patient data (plan.md
// §KPIs & exports), so every call is audited as EXPORT_GENERATED with the row
// count + range — and clinical notes stay excluded unless explicitly
// requested. Named-field selects only (never a model spread).
//
// Load-bearing handler order (same as every admin route): requireStaff ->
// rate limit -> Zod -> read -> audit -> bytes. A 404/400 must NEVER precede a
// 401/403. No CSRF on GET.

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
  const parsedQuery = appointmentsExportQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { month, format, includeNotes } = parsedQuery.data;

  // Month bounds are clinic-local (Africa/Algiers) via the export lib — the
  // only module besides clinicTime.ts that does this date maths, and it
  // delegates to clinicTime.ts per day.
  const { startUTC, endUTC, from, to } = getClinicMonthBoundsUTC(month);

  const appointments = await getPrisma().appointment.findMany({
    where: { startTime: { gte: startUTC, lte: endUTC } },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      source: true,
      createdAt: true,
      confirmedAt: true,
      cancelledAt: true,
      cancelReason: true,
      // Notes are selected only when explicitly requested — otherwise the
      // column is not even read, let alone serialized.
      visitNotes: includeNotes,
      patient: {
        select: { firstName: true, lastName: true, phone: true, phoneE164: true },
      },
      service: { select: { name: true, durationMinutes: true } },
    },
  });

  const rows = buildExportRows(
    appointments.map((a) => ({
      ...a,
      visitNotes: includeNotes ? (a.visitNotes ?? null) : null,
    })),
    { includeNotes },
  );

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.EXPORT_GENERATED,
    "Appointment",
    month,
    // Counts + range + format only — never a patient name/phone/note.
    {
      scope: "appointments-export",
      month,
      from,
      to,
      format,
      includeNotes,
      rowCount: rows.length,
    },
    getClientIp(request.headers),
  );

  const fileName = exportFileName(month, format);
  if (format === "csv") {
    const csv = toCSV(rows, includeNotes);
    const response = new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
    return withRefreshedSession(response, guard);
  }

  const xlsx = toXLSX(rows, includeNotes);
  const response = new Response(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
  return withRefreshedSession(response, guard);
}
