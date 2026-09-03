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
import {
  WAITLIST_READ_RATE_LIMIT,
  WAITLIST_WRITE_RATE_LIMIT,
} from "@/lib/waitlist/rateLimits";
import {
  waitlistCreateSchema,
  waitlistListQuerySchema,
} from "@/schemas/waitlist";
import { validateWatchDates } from "@/lib/booking/watchDates";
import { readBookingPolicy } from "@/lib/booking/policy";
import { getClinicDayBoundsUTC } from "@/lib/time/clinicTime";
import {
  AuditAction,
  AuditActorType,
  WaitlistSource,
} from "@/generated/prisma/client";

// Task 17.2 — GET (list) + POST (STAFF-source create) for
// /api/admin/waitlist. Both staff roles (explicit list, never a bare
// requireStaff — a third role added later must fail closed).
//
// Order is load-bearing in every handler: requireStaff -> (CSRF, on POST)
// -> rate limit -> Zod -> domain checks (404 patient / 404 service / 400
// policy) -> DB write. A 404 must NEVER precede a 401/403.
//
// Audit ruling (documented choice): the GET exposes patient-identifying
// rows (names + phoneE164), so the list read IS audited once with
// PATIENT_RECORD_VIEWED + counters — same as the appointments day view,
// the call queue and the SMS history — but there is NO per-row audit.
// POST is audited with WAITLIST_ENTRY_ADDED (ids + date count only, never
// a phone number). DELETE lives in ./[id]/route.ts.
//
// Date policy: preferredDates are clinic-local YYYY-MM-DD strings validated
// against the live booking policy (readBookingPolicy, same Settings row the
// public booking and the expiry cron use) via validateWatchDates() — the
// same rules the slot engine applies, so staff cannot watch a day the
// clinic would never offer. Each date is stored as that clinic-local date's
// UTC midnight (getClinicDayBoundsUTC().startUTC), the WaitlistEntry
// convention from the schema.

// GET's row shape: named fields only (never a model spread — a spread leaks
// non-column keys and can serialize PII in a PrismaClientValidationError).
const waitlistRowSelect = {
  id: true,
  preferredDates: true,
  source: true,
  active: true,
  notifiedAt: true,
  createdAt: true,
  patient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phoneE164: true,
      active: true,
      anonymizedAt: true,
      messagingOptOut: true,
    },
  },
  service: { select: { id: true, name: true, slug: true } },
} as const;

const DEFAULT_LIMIT = 50;

/** Maps validateWatchDates()'s English reason strings to French staff-facing
 * messages. The shape (YYYY-MM-DD) is already enforced by Zod, so only the
 * two policy reasons can actually surface here. */
function watchPolicyMessage(reason: string): string {
  if (reason.includes("past")) return "Une des dates est dans le passé.";
  if (reason.includes("horizon"))
    return "Une des dates dépasse l'horizon de réservation.";
  return "Dates préférées invalides.";
}

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:waitlist-read`, WAITLIST_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = waitlistListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { serviceId, active, cursor } = parsedQuery.data;
  const limit = parsedQuery.data.limit ?? DEFAULT_LIMIT;

  // `active` is a three-state enum, mapped here to a Prisma filter —
  // "true" (default) shows live entries, "false" the deactivated ones,
  // "all" both. Filters are built ONLY from provided values.
  let entries;
  try {
    entries = await getPrisma().waitlistEntry.findMany({
      where: {
        ...(serviceId ? { serviceId } : {}),
        ...(active === "true" ? { active: true } : {}),
        ...(active === "false" ? { active: false } : {}),
      },
      // Newest first; secondary sort key `id desc` keeps the cursor walk
      // deterministic for rows created in the same millisecond (same
      // reasoning as the audit route).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: waitlistRowSelect,
    });
  } catch {
    return errorResponse(400, "INVALID_CURSOR", "Curseur invalide.");
  }

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "WaitlistEntry",
    "list",
    // Ids, enum and counter only — never a patient name/phone.
    {
      scope: "waitlist-list",
      resultCount: entries.length,
      ...(serviceId ? { serviceId } : {}),
      active,
    },
    getClientIp(request.headers),
  );

  // A full page means there may be more; the last row's id is the next
  // page's cursor (skipped via `skip: 1` on the follow-up request).
  return withRefreshedSession(
    ok({
      entries,
      nextCursor: entries.length === limit ? entries[entries.length - 1].id : null,
    }),
    guard,
  );
}

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:waitlist-write`, WAITLIST_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = waitlistCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { patientId, serviceId } = parsed.data;

  // Dedupe + sort BEFORE policy validation: validateWatchDates() dedupes
  // silently, and a stable ascending order is what the dashboard shows.
  const dates = [...new Set(parsed.data.preferredDates)].sort();

  // Policy check BEFORE any domain read or write: the live booking policy
  // (same Settings row the public booking uses) decides past vs horizon.
  const policy = await readBookingPolicy();
  const watchError = validateWatchDates(dates, policy, new Date());
  if (watchError) {
    return errorResponse(400, "INVALID_WATCH_DATES", watchPolicyMessage(watchError));
  }

  // Domain checks BEFORE any write. Patient: must exist AND be usable — an
  // inactive chart gets the flat 404 (same as manual booking), an erased
  // chart gets 409 PATIENT_ANONYMIZED (same code and message as the
  // documents/visits sibling guards — a fresh waitlist row would re-attach
  // live interest to a supposedly-erased identity).
  const patient = await getPrisma().patient.findUnique({
    where: { id: patientId },
    select: { id: true, active: true, anonymizedAt: true },
  });
  if (!patient || !patient.active) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable ou inactif.");
  }
  if (patient.anonymizedAt !== null) {
    return errorResponse(
      409,
      "PATIENT_ANONYMIZED",
      "Cette fiche a été anonymisée et ne peut plus être modifiée.",
    );
  }

  const service = await getPrisma().service.findFirst({
    where: { id: serviceId, active: true },
    select: { id: true },
  });
  if (!service) {
    return errorResponse(404, "NOT_FOUND", "Service introuvable.");
  }

  // Each clinic-local date becomes that date's UTC midnight — the
  // WaitlistEntry storage convention (Africa/Algiers has no DST, so the
  // mapping is stable; lib/time/clinicTime.ts owns it).
  const entry = await getPrisma().waitlistEntry.create({
    data: {
      patientId: patient.id,
      serviceId: service.id,
      preferredDates: dates.map((d) => getClinicDayBoundsUTC(d).startUTC),
      source: WaitlistSource.STAFF,
      active: true,
    },
    select: waitlistRowSelect,
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.WAITLIST_ENTRY_ADDED,
    "WaitlistEntry",
    entry.id,
    // Ids + count only — never the phone number.
    { patientId: patient.id, serviceId: service.id, dateCount: dates.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ entry }, { status: 201 }), guard);
}
