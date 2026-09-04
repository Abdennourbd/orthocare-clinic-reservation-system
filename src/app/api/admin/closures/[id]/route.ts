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
import { CLOSURES_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — DELETE /api/admin/closures/[id]. ADMIN-only.
// Removing a closure reopens the days for new bookings immediately (the
// engine reads exceptions live). Past closures may be deleted too (cleanup);
// the audit row records what was removed.

type Ctx = { params: Promise<Record<string, string>> };

export async function DELETE(request: NextRequest, context: Ctx) {
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

  const { id } = await context.params;
  const existing = await getPrisma().scheduleException.findUnique({
    where: { id },
    select: { id: true, startDate: true, endDate: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Fermeture introuvable.");
  }

  await getPrisma().scheduleException.delete({ where: { id } });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.CLOSURE_DELETED,
    "ScheduleException",
    id,
    { deleted: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ deleted: true }), guard);
}
