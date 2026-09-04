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
import { WAITLIST_WRITE_RATE_LIMIT } from "@/lib/waitlist/rateLimits";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 17.2 — DELETE /api/admin/waitlist/[id]: removes a patient from the
// staff waitlist by DEACTIVATING the row (active=false), never a hard
// delete — the notifiedAt instant and the watched dates stay readable so
// the entry's history survives (same soft-delete discipline as documents).
//
// Order is load-bearing: requireStaff -> CSRF -> rate limit -> 404. A 404
// must NEVER precede a 401/403. Missing and already-inactive ids answer
// the SAME indistinguishable 404 (same status, code, message) — confirming
// which ids exist would be an existence oracle.
//
// Audit ruling (documented choice): the AuditAction enum has no
// WAITLIST_ENTRY_REMOVED, and inventing one needs a migration no route may
// assume. The deactivation is therefore audited as WAITLIST_ENTRY_ADDED on
// the same WaitlistEntry entity with an explicit `removed: true` flag in
// the detail (ids only) — the append-only trail keeps who removed whom,
// and the flag keeps "added" queries filterable. Next 16: `params` is a
// Promise — awaited before use.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
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

  const { id } = await params;

  const entry = await getPrisma().waitlistEntry.findUnique({
    where: { id },
    select: { id: true, patientId: true, serviceId: true, active: true },
  });
  if (!entry || !entry.active) {
    return errorResponse(404, "NOT_FOUND", "Entrée introuvable.");
  }

  await getPrisma().waitlistEntry.update({
    where: { id: entry.id },
    data: { active: false },
    select: { id: true },
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.WAITLIST_ENTRY_ADDED,
    "WaitlistEntry",
    entry.id,
    // Ids + the removal flag only — never a phone number.
    { removed: true, patientId: entry.patientId, serviceId: entry.serviceId },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ id: entry.id, active: false }), guard);
}
