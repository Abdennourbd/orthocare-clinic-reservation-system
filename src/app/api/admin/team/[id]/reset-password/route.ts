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
import { TEAM_WRITE_RATE_LIMIT } from "@/lib/team/rateLimits";
import { teamResetPasswordSchema } from "@/schemas/team";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 20 — POST /api/admin/team/[id]/reset-password: admin-typed one-time
// password (bounded-design decision). Bumps tokenVersion (revoking live
// sessions), sets mustChangePassword (staff rotates it at next login via
// POST /api/auth/change-password), clears the lockout counters (a reset also
// unlocks). Audited as PASSWORD_RESET. The temporary password is never
// logged, never audited, never returned.

export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:team-write`, TEAM_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await context.params;
  const parsed = teamResetPasswordSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const policy = validatePasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return errorResponse(400, "WEAK_PASSWORD", policy.reason);
  }

  const target = await getPrisma().user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!target) {
    return errorResponse(404, "NOT_FOUND", "Membre introuvable.");
  }

  // No self-reset: rotating your own password without knowing the current
  // one bypasses the current-password check of POST /api/auth/change-password
  // (which is the correct path for changing your own password). Mirrors the
  // PATCH self-deactivate/self-demote guards.
  if (target.id === guard.user.id) {
    return errorResponse(
      400,
      "CANNOT_RESET_SELF",
      "Pour changer votre propre mot de passe, utilisez la page de changement de mot de passe.",
    );
  }

  // Note: resetting a DEACTIVATED account is allowed on purpose (pre-stage
  // a password for a reactivation) — a deactivated account still cannot log
  // in until PATCH {active:true}, so this opens no access path.
  await getPrisma().user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      tokenVersion: { increment: 1 },
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    select: { id: true },
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PASSWORD_RESET,
    "User",
    target.id,
    { forced: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ ok: true }), guard);
}
