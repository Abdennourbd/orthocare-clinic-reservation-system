import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { assertSameOriginStrict } from "@/lib/auth/guard";
import {
  createSessionCookieHeader,
  type SessionRole,
} from "@/lib/auth/session";
import { verifyPassword, DUMMY_HASH } from "@/lib/auth/password";
import { logActionSafe } from "@/lib/audit/logAction";
import { loginSchema } from "@/schemas/auth";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 12 — staff login (plan.md §Auth/RBAC + §Abuse controls).
//   Throttled per IP and per account; repeated failures temporarily lock the
//   account; success/failure/lockout all audited. Responses are generic
//   (INVALID_CREDENTIALS) so the endpoint cannot be used to enumerate accounts.

const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const IP_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };
const ACCOUNT_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

export async function POST(request: NextRequest) {
  // CSRF: a present-but-mismatched Origin/Referer is always hostile.
  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "FORBIDDEN", "Origine non autorisée.");
  }

  // When the client IP cannot be trusted (no trusted proxy header), skip the
  // per-IP bucket entirely: folding everyone into a single shared "unknown"
  // bucket would let one attacker lock the whole clinic out of login. The
  // per-account limiter below still applies.
  const ip = getClientIp(request.headers);
  if (ip) {
    try {
      await checkRateLimit(`login:ip:${ip}`, IP_LIMIT);
    } catch (error) {
      return rateLimited(error);
    }
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Requête invalide.");
  }
  const { email, password } = parsed.data;

  try {
    await checkRateLimit(`login:acct:${email}`, ACCOUNT_LIMIT);
  } catch (error) {
    return rateLimited(error);
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.active) {
    // Generic on purpose — no account-existence oracle. Burn a dummy argon2
    // verification so this path is timing-indistinguishable from a real
    // wrong-password attempt on an existing account.
    await verifyPassword(DUMMY_HASH, password);
    return errorResponse(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect.");
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await verifyPassword(DUMMY_HASH, password);
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: user.id },
      AuditAction.LOGIN_LOCKED,
      "User",
      user.id,
      { reason: "locked_attempt" },
      ip,
    );
    return errorResponse(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect.");
  }
  if (user.lockedUntil) {
    // Expired lock: start the failure counter from zero again. Without this,
    // an already-≥5 counter would re-lock the account on the very next
    // failed attempt forever — one attempt per 15 minutes, indefinitely.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    // Atomic increment: a burst of concurrent bad attempts must each count —
    // a read-modify-write here would let parallel requests overwrite each
    // other and never reach the lockout threshold.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    let lockedUntil: Date | null = null;
    if (
      updated.failedLoginCount >= MAX_ATTEMPTS_BEFORE_LOCK &&
      !updated.lockedUntil
    ) {
      lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil },
      });
    }
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: user.id },
      AuditAction.LOGIN_FAILED,
      "User",
      user.id,
      { failedLoginCount: updated.failedLoginCount },
      ip,
    );
    if (lockedUntil) {
      await logActionSafe(
        { type: AuditActorType.STAFF, userId: user.id },
        AuditAction.LOGIN_LOCKED,
        "User",
        user.id,
        { reason: "too_many_failures", lockedUntil: lockedUntil.toISOString() },
        ip,
      );
    }
    return errorResponse(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect.");
  }

  // Success: reset the throttle counters, stamp lastLoginAt, audit, mint cookie.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  await logActionSafe(
    { type: AuditActorType.STAFF, userId: user.id },
    AuditAction.LOGIN_SUCCESS,
    "User",
    user.id,
    undefined,
    ip,
  );

  const setCookie = await createSessionCookieHeader({
    userId: user.id,
    role: user.role as SessionRole,
    tokenVersion: user.tokenVersion,
  });

  return ok(
    {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    },
    { headers: { "Set-Cookie": setCookie } },
  );
}

function rateLimited(error: unknown): Response {
  if (error instanceof RateLimitError) {
    const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Trop de tentatives. Réessayez plus tard.",
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
  throw error;
}
