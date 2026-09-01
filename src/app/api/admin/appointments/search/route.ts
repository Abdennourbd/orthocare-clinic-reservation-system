import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logAction } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { APPOINTMENTS_READ_RATE_LIMIT } from "@/lib/booking/rateLimits";
import { normalizePhoneE164 } from "@/lib/phone/normalize";
import { normalizeName } from "@/lib/patients/duplicates";
import { appointmentSearchQuerySchema } from "@/schemas/appointment";
import { AuditAction, AuditActorType, type Prisma } from "@/generated/prisma/client";

// Task 14 step 2 — GET /api/admin/appointments/search?q=...: find an
// appointment by phone OR name in ONE search, across all statuses (the front
// desk looks for "the appointment", the status filter is the day view's job).
//
// The patient-matching clauses mirror the patient directory's search
// (src/app/api/admin/patients/route.ts) and inherit BOTH of its protections,
// neither substituting for the other:
//  1. LIKE metacharacters: Prisma's `contains` compiles to Postgres
//     `LIKE ('%' || $1 || '%')` with NO escaping, so `%` and `_` from `q`
//     would act as wildcards — `likeTerm` strips `\`, `%` and `_` first.
//  2. The empty-term trap: stripping metacharacters can reduce a non-empty
//     `q` to an EMPTY string, and `{ contains: "" }` compiles to
//     `LIKE '%%'` which matches EVERY row. Every clause is gated on its
//     term's `.length > 0`, and when no clause survives at all the route
//     answers with an empty list instead of querying.
//
// The phone is tried first as a full normalized E.164 value and, when that
// fails (a partial number or non-digit noise), as a raw-digit substring —
// a receptionist may only remember the last few digits.
//
// Order is load-bearing: requireStaff -> rate limit -> Zod -> DB read.
// Read budget shared with the other appointment reads. The read IS audited,
// with a result COUNT only — the search string `q` is NEVER written to the
// audit log, since it can itself be a patient's name or phone.

const SEARCH_LIMIT = 50;

export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const parsedQuery = appointmentSearchQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const q = parsedQuery.data.q;

  const phoneE164Query = normalizePhoneE164(q);
  const digitsOnly = q.replace(/\D/g, "");
  const likeTerm = q.replace(/[\\%_]/g, "");
  const normalizedQ = likeTerm ? normalizeName(likeTerm) : "";

  const patientClauses: Prisma.PatientWhereInput[] = [
    ...(likeTerm.length > 0
      ? [
          { firstName: { contains: likeTerm, mode: "insensitive" as const } },
          { lastName: { contains: likeTerm, mode: "insensitive" as const } },
        ]
      : []),
    ...(normalizedQ.length > 0
      ? [
          { firstNameNormalized: { contains: normalizedQ } },
          { lastNameNormalized: { contains: normalizedQ } },
        ]
      : []),
    ...(phoneE164Query
      ? [{ phoneE164: { contains: phoneE164Query } }]
      : digitsOnly
        ? [{ phoneE164: { contains: digitsOnly } }]
        : []),
  ];

  // q was non-empty but everything was stripped (e.g. q = "%"): return an
  // empty list rather than run a clause-free query.
  if (patientClauses.length === 0) {
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.PATIENT_RECORD_VIEWED,
      "Appointment",
      "list",
      { scope: "search", resultCount: 0 },
      getClientIp(request.headers),
    );
    return withRefreshedSession(ok({ appointments: [] }), guard);
  }

  // Named fields only, never a model spread.
  const appointments = await getPrisma().appointment.findMany({
    where: { patient: { OR: patientClauses } },
    orderBy: [{ startTime: "desc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      source: true,
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
    },
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Appointment",
    "list",
    // The count only — NEVER the query string `q`.
    { scope: "search", resultCount: appointments.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ appointments }), guard);
}
