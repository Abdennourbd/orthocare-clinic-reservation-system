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
import { PATIENTS_WRITE_RATE_LIMIT } from "@/lib/patients/rateLimits";
import { visitCreateSchema } from "@/schemas/patient";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 13 step 5 — POST /api/admin/patients/[id]/visits: manual history entry
// (a treatment predating this system, or a walk-in with no appointment —
// prisma/schema.prisma comment on `model Visit`). Both staff roles may add
// one (task-13.md §Décisions d'architecture 3 — only deactivation/
// anonymization are ADMIN-only).
//
// Order: requireStaff -> CSRF -> Zod -> 404 (patient) -> 400 (unknown
// serviceId, if provided) -> create. `notes`/`treatment` are free-text
// CLINICAL content (schema.prisma: "confidential"): the audit `detail` below
// carries only `patientId` and `type`, NEVER those two fields — verified by
// tests/integration/patient-record.test.ts.

// `params` is `Promise<Record<string, string>>` rather than the more
// specific `Promise<{ id: string }>` — see the identical comment in
// ../route.ts: it must stay assignable to RouteRow.handler in
// tests/authz-matrix.test.ts by direct reference, no wrapper closure.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  // task-13.md étape 5 tour 2, MINEUR-2 — explicit roles, see the identical
  // comment in ../route.ts.
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-1 — same shared write budget as
  // POST /api/admin/patients and PATCH /[id] (`staff:<userId>:patients-write`,
  // 30/5min, see @/lib/patients/rateLimits).
  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await params;

  const parsed = visitCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const patient = await getPrisma().patient.findUnique({
    where: { id },
    select: { id: true, anonymizedAt: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-2 — an erased chart must never receive
  // fresh clinical notes; that would make the anonymization reversible in
  // substance (new PHI attached to a supposedly-erased identity). Same code
  // and message as the sibling PATCH guard.
  if (patient.anonymizedAt !== null) {
    return errorResponse(
      409,
      "PATIENT_ANONYMIZED",
      "Cette fiche a été anonymisée et ne peut plus être modifiée.",
    );
  }

  if (parsed.data.serviceId) {
    const service = await getPrisma().service.findUnique({
      where: { id: parsed.data.serviceId },
      select: { id: true },
    });
    if (!service) {
      return errorResponse(400, "INVALID_SERVICE", "Service introuvable.");
    }
  }

  const visit = await getPrisma().visit.create({
    data: {
      patientId: id,
      date: new Date(parsed.data.date),
      serviceId: parsed.data.serviceId ?? null,
      type: parsed.data.type,
      notes: parsed.data.notes ?? null,
      treatment: parsed.data.treatment ?? null,
      createdById: guard.user.id,
    },
    select: {
      id: true,
      patientId: true,
      date: true,
      serviceId: true,
      type: true,
      notes: true,
      treatment: true,
      createdAt: true,
    },
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.VISIT_CREATED,
    "Visit",
    visit.id,
    // Never `notes`/`treatment` — free-text clinical content.
    { patientId: id, type: visit.type },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(visit, { status: 201 }), guard);
}
