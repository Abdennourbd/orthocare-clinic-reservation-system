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
import { teamPatchSchema } from "@/schemas/team";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 20 — PATCH /api/admin/team/[id]: edit name, change role, deactivate /
// reactivate. ADMIN-only. Deactivation bumps tokenVersion (revoking live
// sessions instantly via the guard's DB check); role/name changes do not —
// the guard reads the live DB role on every request, so they take effect
// immediately without revocation.
//
// Guards: cannot deactivate self, cannot demote/deactivate the last active
// ADMIN (the clinic must never lock itself out). Audit: deactivation as
// TEAM_MEMBER_DEACTIVATED, role change as TEAM_MEMBER_ROLE_CHANGED (ids +
// enums only). Name-only edits are not audited — no dedicated action exists
// and the spec requires creation/deactivation/role/reset only.

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

export async function PATCH(
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
  const parsed = teamPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const target = await getPrisma().user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true, tokenVersion: true },
  });
  if (!target) {
    return errorResponse(404, "NOT_FOUND", "Membre introuvable.");
  }

  const { name, role, active } = parsed.data;
  const isSelf = target.id === guard.user.id;

  if (isSelf && active === false) {
    return errorResponse(400, "CANNOT_DEACTIVATE_SELF", "Vous ne pouvez pas désactiver votre propre compte.");
  }
  if (isSelf && role !== undefined && role !== "ADMIN") {
    return errorResponse(400, "CANNOT_DEMOTE_SELF", "Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
  }

  const roleChanging = role !== undefined && role !== target.role;
  const activeChanging = active !== undefined && active !== target.active;
  const losingAdmin =
    target.role === "ADMIN" &&
    target.active &&
    (active === false || role === "RECEPTIONIST");

  if (losingAdmin) {
    const otherAdmins = await getPrisma().user.count({
      where: { role: "ADMIN", active: true, id: { not: target.id } },
    });
    if (otherAdmins === 0) {
      return errorResponse(
        400,
        "LAST_ADMIN",
        "Impossible : ce compte est le dernier administrateur actif.",
      );
    }
  }

  const updated = await getPrisma().user.update({
    where: { id: target.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      // Revoke live sessions on (de)activation — the guard compares
      // tokenVersion against the DB on every request.
      ...(activeChanging ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: teamRowSelect,
  });

  const ip = getClientIp(request.headers);
  if (activeChanging) {
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.TEAM_MEMBER_DEACTIVATED,
      "User",
      target.id,
      { active: updated.active },
      ip,
    );
  }
  if (roleChanging) {
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.TEAM_MEMBER_ROLE_CHANGED,
      "User",
      target.id,
      { from: target.role, to: updated.role },
      ip,
    );
  }

  return withRefreshedSession(ok({ user: updated }), guard);
}
