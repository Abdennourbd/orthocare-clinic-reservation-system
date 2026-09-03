import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { APPOINTMENTS_READ_RATE_LIMIT } from "@/lib/booking/rateLimits";
import { kpisQuerySchema } from "@/schemas/kpis";
import {
  computeKpis,
  getClinicWeekRange,
} from "@/lib/kpis/aggregations";
import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";

// Task 18 — GET /api/admin/kpis: week (Sat→Thu) aggregates for the dashboard
// home. Both staff roles can read (the dashboard home renders for everyone);
// NO audit row — the response carries counts/rates only, never a name, phone
// or note (same ruling as the SMS batches list).
//
// Load-bearing handler order (same as every admin route): requireStaff ->
// rate limit -> Zod -> read. A 404/400 must NEVER precede a 401/403. No CSRF
// on GET. Reads share the appointments-read pool (one pool per staff session).

const MAX_RANGE_DAYS = 366;

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
  const parsedQuery = kpisQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }

  // "Today" is the CLINIC's today — all date maths goes through clinicTime.ts.
  const todayLocal = toClinicLocalDateString(new Date());
  const week = getClinicWeekRange(todayLocal);
  const from = parsedQuery.data.from ?? week.from;
  const to = parsedQuery.data.to ?? week.to;

  if (from > to) {
    return errorResponse(400, "VALIDATION_ERROR", "La date de début doit précéder la date de fin.");
  }
  const { startUTC: fromStart } = getClinicDayBoundsUTC(from);
  const { endUTC: toEnd } = getClinicDayBoundsUTC(to);
  if ((toEnd.getTime() - fromStart.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
    return errorResponse(400, "VALIDATION_ERROR", "La période est limitée à 366 jours.");
  }

  const prisma = getPrisma();
  const [appointments, patients, workingHoursSetting] = await Promise.all([
    prisma.appointment.findMany({
      where: { startTime: { gte: fromStart, lte: toEnd } },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      select: {
        status: true,
        source: true,
        startTime: true,
        endTime: true,
        createdAt: true,
        confirmedAt: true,
        cancelReason: true,
      },
    }),
    prisma.patient.findMany({
      where: { createdAt: { gte: fromStart, lte: toEnd } },
      select: { createdAt: true },
    }),
    prisma.setting.findUnique({ where: { key: "workingHours" } }),
  ]);

  const kpis = computeKpis({
    appointments,
    patients,
    workingHours: (workingHoursSetting?.value ?? {}) as unknown,
    from,
    to,
    today: todayLocal,
  });

  return withRefreshedSession(ok({ range: { from, to }, kpis }), guard);
}
