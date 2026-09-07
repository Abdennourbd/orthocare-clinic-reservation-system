import { revalidateTagSafe } from "@/lib/cache/revalidate";
import { NextRequest } from "next/server";
import { z } from "zod";
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
import { caseExtraCreateSchema } from "@/schemas/case";
import { MAX_EXTRAS_PER_CASE } from "@/lib/gallery/images";
import { blobKeyFromUrl, deleteCaseImage } from "@/lib/gallery/blobStorage";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// G2 — POST (add extra picture) + DELETE (remove one) for
// /api/admin/cases/[id]/images. ADMIN-only. Max MAX_EXTRAS_PER_CASE extras
// per case, enforced here against the live count (Zod can't see the DB).

type Ctx = { params: Promise<Record<string, string>> };

const extraImageSelect = {
  id: true,
  imageUrl: true,
  caption: true,
  sortOrder: true,
} as const;

const deleteBodySchema = z.object({ imageId: z.string().trim().min(1, "L'image est requise.") });

export async function POST(request: NextRequest, context: Ctx) {
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
  const parsed = caseExtraCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const existing = await getPrisma().smileCase.findUnique({
    where: { id },
    select: { id: true, key: true, _count: { select: { images: true } } },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Cas introuvable.");
  }
  if (existing._count.images >= MAX_EXTRAS_PER_CASE) {
    return errorResponse(409, "EXTRAS_LIMIT", `Un cas accepte ${MAX_EXTRAS_PER_CASE} photos supplémentaires maximum.`);
  }

  const image = await getPrisma().smileCaseImage.create({
    data: {
      caseId: id,
      imageUrl: parsed.data.imageUrl,
      caption: parsed.data.caption as object,
      sortOrder: parsed.data.sortOrder ?? existing._count.images,
    },
    select: extraImageSelect,
  });

  revalidateTagSafe("gallery", "max");

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "SmileCaseImage",
    image.id,
    { caseKey: existing.key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ image }, { status: 201 }), guard);
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
  const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const image = await getPrisma().smileCaseImage.findFirst({
    where: { id: parsed.data.imageId, caseId: id },
    select: { id: true, imageUrl: true, smileCase: { select: { key: true } } },
  });
  if (!image) {
    return errorResponse(404, "NOT_FOUND", "Photo introuvable.");
  }

  await getPrisma().smileCaseImage.delete({ where: { id: image.id } });
  revalidateTagSafe("gallery", "max");

  // Best-effort blob cleanup (same discipline as case DELETE).
  const key = blobKeyFromUrl(image.imageUrl);
  if (key) {
    try {
      await deleteCaseImage(key);
    } catch {
      // Already reported inside deleteCaseImage; the row is gone either way.
    }
  }

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "SmileCaseImage",
    image.id,
    { caseKey: image.smileCase.key, deleted: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ deleted: true }), guard);
}
