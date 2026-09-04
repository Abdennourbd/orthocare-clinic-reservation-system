import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/api/http";
import { getPrisma } from "@/lib/db";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { assertSameOriginStrict, requireStaff } from "@/lib/auth/guard";
import { createSessionCookieHeader, type SessionRole } from "@/lib/auth/session";
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/auth/password";
import { logActionSafe } from "@/lib/audit/logAction";
import { changePasswordSchema } from "@/schemas/auth";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 12 — password change (plan.md §Auth/RBAC). Serves both the voluntary
// change and the forced one after an admin-issued reset (`mustChangePassword`).
// The change bumps `tokenVersion`, which revokes every other live session
// immediately; a fresh cookie for the current session is issued in the same
// response so the staff member is not logged out.

export async function POST(request: NextRequest) {
  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "FORBIDDEN", "Origine non autorisée.");
  }

  const guard = await requireStaff(request, { allowPasswordChangePending: true });
  if (!guard.ok) return guard.response;

  // Throttle current-password guessing from a (possibly hijacked or abandoned)
  // session. Success enables a persistent takeover, so the credential check
  // needs the same class of abuse control as login.
  try {
    await checkRateLimit(`pwchange:${guard.user.id}`, { limit: 10, windowMs: 5 * 60 * 1000 });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de tentatives. Réessayez plus tard.");
    }
    throw error;
  }

  const parsed = changePasswordSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Requête invalide.");
  }
  const { currentPassword, newPassword } = parsed.data;

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.ok) {
    return errorResponse(400, "WEAK_PASSWORD", policy.reason);
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: guard.user.id } });
  if (!user || !user.active) {
    return errorResponse(401, "UNAUTHENTICATED", "Session invalide ou expirée.");
  }

  const currentValid = await verifyPassword(user.passwordHash, currentPassword);
  if (!currentValid) {
    return errorResponse(400, "INVALID_PASSWORD", "Mot de passe actuel incorrect.");
  }

  const newTokenVersion = user.tokenVersion + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      tokenVersion: newTokenVersion,
      mustChangePassword: false,
    },
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: user.id },
    AuditAction.PASSWORD_RESET,
    "User",
    user.id,
    { forced: user.mustChangePassword },
  );

  const setCookie = await createSessionCookieHeader({
    userId: user.id,
    role: user.role as SessionRole,
    tokenVersion: newTokenVersion,
  });

  return ok({ ok: true }, { headers: { "Set-Cookie": setCookie } });
}
