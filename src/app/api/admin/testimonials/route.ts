import { revalidateTag } from "next/cache";
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
import {
  CONTENT_READ_RATE_LIMIT,
  CONTENT_WRITE_RATE_LIMIT,
} from "@/lib/content/rateLimits";
import { testimonialCreateSchema } from "@/schemas/content";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — GET (list) + POST (create) for /api/admin/testimonials.
// ADMIN-only. GET ordered by `key asc` (matches the public editorial order
// in src/lib/public/content.ts). Writes revalidate the `testimonial` cache
// tag so the Task 11 public page reflects edits within the prod TTL.

const rowSelect = {
  id: true,
  key: true,
  author: true,
  content: true,
  rating: true,
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

  const testimonials = await getPrisma().testimonial.findMany({
    orderBy: { key: "asc" },
    select: rowSelect,
  });

  return withRefreshedSession(ok({ testimonials }), guard);
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

  const parsed = testimonialCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  let testimonial;
  try {
    testimonial = await getPrisma().testimonial.create({
      data: {
        key: parsed.data.key,
        author: parsed.data.author as object,
        content: parsed.data.content as object,
        rating: parsed.data.rating,
        active: parsed.data.active ?? true,
      },
      select: rowSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "KEY_TAKEN", "Un témoignage existe déjà avec cette clé.");
    }
    throw e;
  }

  revalidateTag("testimonial", "max");

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "Testimonial",
    testimonial.id,
    // Key only — never the body (audit stays small, no PII drift).
    { key: testimonial.key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ testimonial }, { status: 201 }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
