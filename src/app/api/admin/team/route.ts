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
import { TEAM_READ_RATE_LIMIT, TEAM_WRITE_RATE_LIMIT } from "@/lib/team/rateLimits";
import { teamCreateSchema } from "@/schemas/team";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 20 — GET (list) + POST (create RECEPTIONIST) for /api/admin/team.
// ADMIN-only: team management is least-privilege (plan.md §Auth/RBAC).
//
// Order is load-bearing: requireStaff -> (CSRF, on POST) -> rate limit ->
// Zod -> policy/domain checks -> DB write. A 400/404/409 must NEVER precede
// a 401/403. Named-field selects only (never a model spread — a spread would
// serialize passwordHash).

const teamRowSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:team-read`, TEAM_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const members = await getPrisma().user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: teamRowSelect,
  });

  return withRefreshedSession(ok({ members }), guard);
}

export async function POST(request: NextRequest) {
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

  const parsed = teamCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { name, email, password } = parsed.data;

  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    return errorResponse(400, "WEAK_PASSWORD", policy.reason);
  }

  const existing = await getPrisma().user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return errorResponse(409, "EMAIL_TAKEN", "Un compte existe déjà avec cet email.");
  }

  // Receptionist only (bounded-design decision): the create path never mints
  // an ADMIN — promotion goes through PATCH (audited as ROLE_CHANGED).
  const user = await getPrisma().user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "RECEPTIONIST",
      active: true,
      mustChangePassword: true,
    },
    select: teamRowSelect,
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.TEAM_MEMBER_CREATED,
    "User",
    user.id,
    // Ids + staff email + role only — never the (temporary) password.
    { email: user.email, role: user.role },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ user }, { status: 201 }), guard);
}
