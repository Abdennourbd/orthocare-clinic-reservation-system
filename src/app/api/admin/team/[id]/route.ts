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
import { TEAM_WRITE_RATE_LIMIT } from "@/lib/team/rateLimits";
import { teamRowSelect } from "@/lib/team/select";
import { teamPatchSchema } from "@/schemas/team";
import { AuditAction, AuditActorType, Prisma } from "@/generated/prisma/client";

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

class LastAdminError extends Error {
  constructor() {
    super("last-admin");
    this.name = "LastAdminError";
  }
}

class SelfGuardError extends Error {
  constructor(
    public readonly code: "CANNOT_DEACTIVATE_SELF" | "CANNOT_DEMOTE_SELF",
    message: string,
  ) {
    super(message);
    this.name = "SelfGuardError";
  }
}

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

  const roleChanging = role !== undefined && role !== target.role;
  const activeChanging = active !== undefined && active !== target.active;
  const losingAdmin =
    target.role === "ADMIN" &&
    target.active &&
    (active === false || role === "RECEPTIONIST");

  // Atomic check-and-mutate in one serializable transaction. The order
  // inside is deliberate:
  //   1. last-admin first: a lone admin removing their own privilege gets
  //      LAST_ADMIN (the clinic-wide lockout matters more than the self
  //      rule), which also keeps every branch reachable and tested;
  //   2. self-guards next (CANNOT_DEACTIVATE_SELF / CANNOT_DEMOTE_SELF);
  //   3. the update last.
  // Without the transaction, two concurrent demotions of the last two
  // admins could both observe "one other admin left" and both commit —
  // zero active admins, recoverable only by direct DB intervention.
  // (No write happens before a throw, so aborted validations cost nothing.)
  let updated;
  try {
    updated = await getPrisma().$transaction(
      async (tx) => {
        if (losingAdmin) {
          const otherAdmins = await tx.user.count({
            where: { role: "ADMIN", active: true, id: { not: target.id } },
          });
          if (otherAdmins === 0) throw new LastAdminError();
        }
        if (isSelf && active === false) {
          throw new SelfGuardError(
            "CANNOT_DEACTIVATE_SELF",
            "Vous ne pouvez pas désactiver votre propre compte.",
          );
        }
        if (isSelf && role !== undefined && role !== "ADMIN") {
          throw new SelfGuardError(
            "CANNOT_DEMOTE_SELF",
            "Vous ne pouvez pas retirer votre propre rôle d'administrateur.",
          );
        }
        return tx.user.update({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof LastAdminError) {
      return errorResponse(
        400,
        "LAST_ADMIN",
        "Impossible : ce compte est le dernier administrateur actif.",
      );
    }
    if (e instanceof SelfGuardError) {
      return errorResponse(400, e.code, e.message);
    }
    // Serialization conflict under concurrency — safe to retry, never to
    // silently commit past the last-admin guard.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2034") {
      return errorResponse(409, "CONFLICT", "Conflit de concurrence. Veuillez réessayer.");
    }
    throw e;
  }

  const ip = getClientIp(request.headers);
  if (activeChanging) {
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.TEAM_MEMBER_DEACTIVATED,
      "User",
      target.id,
      // from/to (not just the new flag): a reactivation reuses this action
      // (no TEAM_MEMBER_REACTIVATED exists in the enum), so the direction
      // must be explicit in the detail for the journal to stay readable.
      { from: target.active, to: updated.active },
      ip,
    );
  }
  if (roleChanging) {
    await logActionSafe(
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
