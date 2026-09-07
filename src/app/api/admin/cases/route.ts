import { NextRequest } from "next/server";
import { revalidateTagSafe } from "@/lib/cache/revalidate";
import { getPrisma } from "@/lib/db";import { errorResponse, ok } from "@/lib/api/http";
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
import { caseCreateSchema } from "@/schemas/case";
import {
  caseRowSelect,
  consentRefusal,
  featuredCapReached,
} from "@/lib/gallery/admin";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// G2 — GET (list) + POST (create) for /api/admin/cases. ADMIN-only.
// Writes revalidate the `gallery` cache tag (public case pages).

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

  const cases = await getPrisma().smileCase.findMany({
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    select: { ...caseRowSelect, _count: { select: { images: true } } },
  });

  return withRefreshedSession(ok({ cases }), guard);
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

  const parsed = caseCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const active = parsed.data.active ?? false;
  const consentConfirmed = parsed.data.consentConfirmed ?? false;
  const refusal = consentRefusal(active, consentConfirmed);
  if (refusal) {
    return errorResponse(400, "CONSENT_REQUIRED", refusal);
  }

  if (parsed.data.featured === true && (await featuredCapReached())) {
    return errorResponse(409, "FEATURED_LIMIT", "La page d'accueil affiche 4 cas maximum.");
  }

  let item;
  try {
    item = await getPrisma().smileCase.create({
      data: {
        key: parsed.data.key,
        title: parsed.data.title as object,
        description: parsed.data.description as object,
        beforeImageUrl: parsed.data.beforeImageUrl,
        afterImageUrl: parsed.data.afterImageUrl,
        active,
        sortOrder: parsed.data.sortOrder ?? 0,
        featured: parsed.data.featured ?? false,
        featuredOrder: parsed.data.featuredOrder ?? 0,
        consentConfirmed,
        ...(consentConfirmed ? { consentAt: new Date() } : {}),
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

  return withRefreshedSession(ok({ item }, { status: 201 }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
