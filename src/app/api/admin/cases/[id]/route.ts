import { revalidateTagSafe } from "@/lib/cache/revalidate";
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
import { CONTENT_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { casePatchSchema } from "@/schemas/case";
import {
  caseRowSelect,
  consentRefusal,
  deleteCaseBlobsBestEffort,
  featuredCapReached,
} from "@/lib/gallery/admin";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// G2 — PATCH + DELETE for /api/admin/cases/[id]. ADMIN-only.
// DELETE hard-deletes (content, not patient data): the row, its extras via
// FK cascade, then best-effort blob cleanup for our own store URLs.

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
  const parsed = casePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const existing = await getPrisma().smileCase.findUnique({
    where: { id },
    select: { id: true, key: true, active: true, consentConfirmed: true, featured: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Cas introuvable.");
  }

  if (parsed.data.key && parsed.data.key !== existing.key) {
    const clash = await getPrisma().smileCase.findUnique({
      where: { key: parsed.data.key },
      select: { id: true },
    });
    if (clash) {
      return errorResponse(409, "KEY_TAKEN", "Un cas existe déjà avec cette clé.");
    }
  }

  const nextActive = parsed.data.active ?? existing.active;
  const nextConsent = parsed.data.consentConfirmed ?? existing.consentConfirmed;
  const refusal = consentRefusal(nextActive, nextConsent);
  if (refusal) {
    return errorResponse(400, "CONSENT_REQUIRED", refusal);
  }

  const nextFeatured = parsed.data.featured ?? existing.featured;
  if (nextFeatured && !existing.featured && (await featuredCapReached(existing.id))) {
    return errorResponse(409, "FEATURED_LIMIT", "La page d'accueil affiche 4 cas maximum.");
  }

  const consentJustGiven = parsed.data.consentConfirmed === true && !existing.consentConfirmed;

  let item;
  try {
    item = await getPrisma().smileCase.update({
      where: { id },
      data: {
        ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title as object } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description as object }
          : {}),
        ...(parsed.data.beforeImageUrl !== undefined
          ? { beforeImageUrl: parsed.data.beforeImageUrl }
          : {}),
        ...(parsed.data.afterImageUrl !== undefined
          ? { afterImageUrl: parsed.data.afterImageUrl }
          : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        ...(parsed.data.featured !== undefined ? { featured: parsed.data.featured } : {}),
        ...(parsed.data.featuredOrder !== undefined
          ? { featuredOrder: parsed.data.featuredOrder }
          : {}),
        ...(parsed.data.consentConfirmed !== undefined
          ? { consentConfirmed: parsed.data.consentConfirmed }
          : {}),
        ...(consentJustGiven ? { consentAt: new Date() } : {}),
      },
      select: caseRowSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "KEY_TAKEN", "Un cas existe déjà avec cette clé.");
    }
    throw e;
  }

  revalidateTagSafe("gallery", "max");

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "SmileCase",
    item.id,
    { key: item.key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ item }), guard);
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
  const existing = await getPrisma().smileCase.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      beforeImageUrl: true,
      afterImageUrl: true,
      images: { select: { imageUrl: true } },
    },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Cas introuvable.");
  }

  await getPrisma().smileCase.delete({ where: { id } });
  revalidateTagSafe("gallery", "max");

  await deleteCaseBlobsBestEffort([
    existing.beforeImageUrl,
    existing.afterImageUrl,
    ...existing.images.map((i) => i.imageUrl),
  ]);

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "SmileCase",
    id,
    { key: existing.key, deleted: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ deleted: true }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
