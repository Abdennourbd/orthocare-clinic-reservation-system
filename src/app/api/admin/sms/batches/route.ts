import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { SMS_READ_RATE_LIMIT } from "@/lib/messaging/rateLimits";
import { smsBatchesQuerySchema } from "@/schemas/sms";

// Task 16 — GET /api/admin/sms/batches: the list of past delay-broadcast
// batches for the dashboard (ADMIN + RECEPTIONIST). Metadata only: dates,
// counters, ids and the sender's display name — no message bodies, no patient
// rows. Unlike the history read (GET /api/admin/sms) this GET is therefore
// NOT audited: nothing patient-identifying crosses this endpoint.
//
// Same load-bearing handler order as every admin route (no CSRF on GET):
// requireStaff -> rate limit -> Zod -> read. A 404 must NEVER precede a
// 401/403.

// Named fields only (never a model spread — a spread leaks non-column keys
// and can serialize PII in a PrismaClientValidationError).
const smsBatchRowSelect = {
  id: true,
  date: true,
  delayMinutes: true,
  recipientCount: true,
  sentCount: true,
  suppressedCount: true,
  failedCount: true,
  createdAt: true,
  sentBy: { select: { name: true } },
} as const;

const DEFAULT_LIMIT = 50;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    // Same read pool budget as the history GET (SMS_READ_RATE_LIMIT) but a
    // SEPARATE bucket key, so paging the batch list never eats the history
    // budget and vice versa.
    await checkRateLimit(`staff:${guard.user.id}:sms-batches`, SMS_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = smsBatchesQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const limit = parsedQuery.data.limit ?? DEFAULT_LIMIT;

  // Secondary sort key `id desc`: batches created in the same millisecond
  // need a deterministic order (same reasoning as the audit route).
  const batches = await getPrisma().smsBroadcast.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: smsBatchRowSelect,
  });

  return withRefreshedSession(ok({ batches }), guard);
}
