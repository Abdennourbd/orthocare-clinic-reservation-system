import { revalidateTag } from "next/cache";
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
import {
  CONTENT_READ_RATE_LIMIT,
  CONTENT_WRITE_RATE_LIMIT,
} from "@/lib/content/rateLimits";
import { galleryCreateSchema } from "@/schemas/content";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — GET (list) + POST (create) for /api/admin/gallery. ADMIN-only.
// v1 is URL-paste only (no upload flow — gallery images live in
// public/images or the Blob store already). Writes revalidate the `gallery`
// cache tag (public gallery page, Task 11).

const rowSelect = {
  id: true,
  key: true,
  imageUrl: true,
  caption: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:content-read`, CONTENT_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const items = await getPrisma().galleryItem.findMany({
    orderBy: { key: "asc" },
    select: rowSelect,
  });

  return withRefreshedSession(ok({ gallery: items }), guard);
}

export async function POST(request: NextRequest) {
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

  const parsed = galleryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  let item;
  try {
    item = await getPrisma().galleryItem.create({
      data: {
        key: parsed.data.key,
        imageUrl: parsed.data.imageUrl,
        caption: parsed.data.caption as object,
        active: parsed.data.active ?? true,
      },
      select: rowSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "KEY_TAKEN", "Une image existe déjà avec cette clé.");
    }
    throw e;
  }

  revalidateTag("gallery", "max");

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "GalleryItem",
    item.id,
    { key: item.key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ item }, { status: 201 }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
