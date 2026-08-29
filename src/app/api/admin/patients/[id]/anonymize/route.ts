import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { PATIENTS_WRITE_RATE_LIMIT } from "@/lib/patients/rateLimits";
import { anonymizeSchema } from "@/schemas/patient";
import {
  anonymizePatient,
  PatientAlreadyAnonymizedError,
  PatientNotFoundError,
} from "@/lib/privacy/anonymize";
import { AuditActorType } from "@/generated/prisma/client";

// Task 13 step 6 — POST /api/admin/patients/[id]/anonymize: honors an
// erasure request. ADMIN-only (task-13.md §Décisions d'architecture 3 — the
// second and most destructive of the two ADMIN-only operations on this
// screen), and irreversible: there is no undo button anywhere in this task.
//
// Order is load-bearing, same convention as every route in this family
// (../route.ts, ../visits/route.ts) plus the extra write-rate-limit step
// task-13.md's étape 6 audit explicitly requires: requireStaff -> CSRF ->
// rate limit -> Zod (`{ confirm: true }`, guards an accidental empty POST)
// -> 404 (unknown id) -> 409 (already anonymized) -> anonymizePatient(). A
// 404/409 must never precede the 401/403 the role/CSRF/rate-limit checks can
// produce.

/**
 * `params` is `Promise<Record<string, string>>`, not the more specific
 * `Promise<{ id: string }>` — see the identical comment in ../route.ts: it
 * must stay assignable to RouteRow.handler in tests/authz-matrix.test.ts by
 * direct reference, no wrapper closure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 5,
  // point 1 — an irreversible ADMIN route with no rate limit at all would be
  // the worst case of the gap that MAJEUR-1 fixed on PATCH/POST visits.
  // Same shared write budget, same key shape.
  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = anonymizeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { id } = await params;

  const existing = await getPrisma().patient.findUnique({
    where: { id },
    select: { id: true, anonymizedAt: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }
  if (existing.anonymizedAt !== null) {
    return errorResponse(409, "ALREADY_ANONYMIZED", "Cette fiche a déjà été anonymisée.");
  }

  let result;
  try {
    result = await anonymizePatient(
      id,
      { type: AuditActorType.STAFF, userId: guard.user.id },
      getClientIp(request.headers),
    );
  } catch (e) {
    // Defense in depth against a race with a concurrent anonymize call — the
    // module re-checks inside its own transaction (see anonymize.ts). The
    // pre-checks above make this the common path's 404/409, not this catch.
    if (e instanceof PatientAlreadyAnonymizedError) {
      return errorResponse(409, "ALREADY_ANONYMIZED", "Cette fiche a déjà été anonymisée.");
    }
    if (e instanceof PatientNotFoundError) {
      return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
    }
    throw e;
  }

  // Minimal response — no erased value, no SMS count either (that lives only
  // in the audit detail, task-13.md étape 6 spec).
  return withRefreshedSession(
    ok({
      id: result.id,
      anonymizedAt: result.anonymizedAt,
      appointmentsKept: result.appointmentsKept,
      visitsKept: result.visitsKept,
    }),
    guard,
  );
}
