import { getPrisma } from "@/lib/db";
import {
  AuditAction,
  AuditActorType,
  type Prisma,
} from "@/generated/prisma/client";
import * as Sentry from "@sentry/nextjs";

// Shared audit trail (plan.md §Audit logging). Every state-changing staff
// action, patient-initiated action and SYSTEM (cron) action goes through this
// helper. Append-only: nothing in the application ever updates or deletes
// AuditLog rows. Reading it (ADMIN-only) is itself audited — that's Task 12's
// read surface.
//
// The actor model (STAFF | SYSTEM | PATIENT) is what Task 8's self-service
// actions need: there is no staff user behind a patient clicking a link, and
// no user at all behind a cron job, so a userId-only signature could not
// express either.

export type AuditActor = {
  type: AuditActorType;
  /** Only meaningful for STAFF actors; SYSTEM/PATIENT leave it unset. */
  userId?: string;
};

export type AuditDetail = Record<string, unknown>;

/** Reusable actor for cron/system actions — no staff user is behind a cron
 * job, so `userId` is always unset (plan.md §Audit logging, Task 9). */
export const SYSTEM_ACTOR = { type: AuditActorType.SYSTEM } as const;

export async function logAction(
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string,
  detail?: AuditDetail,
  ipAddress?: string | null,
): Promise<void> {
  await getPrisma().auditLog.create({
    data: {
      actorType: actor.type,
      userId: actor.userId ?? null,
      action,
      entityType,
      entityId,
      detail: (detail ?? {}) as Prisma.InputJsonValue,
      ipAddress: ipAddress ?? null,
    },
  });
}

/**
 * Post-commit audit: same write, but never throws. A committed operation
 * (status change, reschedule, cancellation, export…) must never surface as
 * a 500 just because its audit row failed — the client would retry into
 * 409/410 confusion while the write already happened. Failures are reported
 * to Sentry with action/entity labels only, never `detail` (patient data).
 */
export async function logActionSafe(
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string,
  detail?: AuditDetail,
  ipAddress?: string | null,
): Promise<void> {
  try {
    await logAction(actor, action, entityType, entityId, detail, ipAddress);
  } catch (e) {
    try {
      Sentry.captureException(e, {
        tags: { scope: "audit-log", action, entityType },
      });
    } catch {
      // Reporting must never throw either.
    }
  }
}
