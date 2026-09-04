import { NextRequest } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { AuditAction, AuditActorType, type Prisma } from "@/generated/prisma/client";

// Task 12 — ADMIN-only audit viewer API (plan.md §Audit logging).
//   Reading the audit trail is itself audited (AUDIT_VIEWED). Append-only:
//   this route only ever reads.

const auditQuerySchema = z.object({
  action: z
    .string()
    .regex(/^[A-Z][A-Z_]*$/, "Action inconnue")
    .refine((value) => (Object.values(AuditAction) as string[]).includes(value), {
      message: "Action inconnue",
    })
    .optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});

const DEFAULT_LIMIT = 50;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsedQuery = auditQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { action, entityType, entityId, userId, from, to } = parsedQuery.data;
  const limit = Math.min(parsedQuery.data.limit ?? DEFAULT_LIMIT, 200);
  const page = parsedQuery.data.page ?? 1;

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action: action as AuditAction } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(userId ? { userId } : {}),
    ...((from || to) && {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    }),
  };

  const [total, entries] = await Promise.all([
    getPrisma().auditLog.count({ where }),
    getPrisma().auditLog.findMany({
      where,
      // Secondary sort key: entries created in the same millisecond must have
      // a deterministic order (createdAt alone is not unique per row).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: (page - 1) * limit,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.AUDIT_VIEWED,
    "AuditLog",
    "audit",
    { filters: { action, entityType, entityId, userId, from, to, page } },
  );

  return withRefreshedSession(
    ok({
      entries: entries.map((entry) => ({
        id: entry.id,
        actorType: entry.actorType,
        userId: entry.userId,
        userName: entry.user?.name ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: entry.detail,
        ipAddress: entry.ipAddress,
        createdAt: entry.createdAt,
      })),
      total,
      page,
      limit,
    }),
    guard,
  );
}
