import { getPrisma } from "@/lib/db";
import {
  AuditAction,
  AuditActorType,
  type Prisma,
} from "@/generated/prisma/client";

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