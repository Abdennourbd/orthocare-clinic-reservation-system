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
import { CONTENT_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { servicePatchSchema } from "@/schemas/services";
import {
  AuditAction,
  AuditActorType,
  AppointmentStatus,
} from "@/generated/prisma/client";

// Task 21 — PATCH + DELETE for /api/admin/services/[id]. ADMIN-only.
//
// DELETE never drops booked work silently: a service with PENDING/CONFIRMED
// appointments is refused with 409 SERVICE_IN_USE (the dashboard steers
// staff toward deactivation via PATCH {active:false} instead).

const serviceRowSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  durationMinutes: true,
  price: true,
  currency: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Ctx = { params: Promise<Record<string, string>> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:content-write`, CONTENT_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await context.params;
  const parsed = servicePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const existing = await getPrisma().service.findUnique({
    where: { id },
    select: { id: true, slug: true, durationMinutes: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Service introuvable.");
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const clash = await getPrisma().service.findUnique({
      where: { slug: parsed.data.slug },
      select: { id: true },
    });
    if (clash) {
      return errorResponse(409, "SLUG_TAKEN", "Un service existe déjà avec ce slug.");
    }
  }

  const { slug, name, description, durationMinutes, price, currency, active } = parsed.data;
  let service;
  try {
    service = await getPrisma().service.update({
      where: { id },
      data: {
        ...(slug !== undefined ? { slug } : {}),
        ...(name !== undefined ? { name: name as object } : {}),
        ...(description !== undefined ? { description: description as object } : {}),
        ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(active !== undefined ? { active } : {}),
      },
      select: serviceRowSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "SLUG_TAKEN", "Un service existe déjà avec ce slug.");
    }
    throw e;
  }

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "Service",
    service.id,
    {
      slug: service.slug,
      ...(durationMinutes !== undefined
        ? { beforeDuration: existing.durationMinutes, afterDuration: service.durationMinutes }
        : {}),
    },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ service }), guard);
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:content-write`, CONTENT_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await context.params;
  const existing = await getPrisma().service.findUnique({
    where: { id },
    select: { id: true, slug: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Service introuvable.");
  }

  const activeCount = await getPrisma().appointment.count({
    where: {
      serviceId: id,
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
    },
  });
  if (activeCount > 0) {
    return errorResponse(
      409,
      "SERVICE_IN_USE",
      "Ce service a des rendez-vous à venir. Désactivez-le plutôt que de le supprimer.",
    );
  }

  await getPrisma().service.delete({ where: { id } });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "Service",
    id,
    { slug: existing.slug, deleted: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ deleted: true }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
