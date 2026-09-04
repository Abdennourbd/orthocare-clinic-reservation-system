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
import { faqCreateSchema } from "@/schemas/content";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — GET (list) + POST (create) for /api/admin/faqs. ADMIN-only.
// Writes revalidate the `faq` cache tag (public FAQ page, Task 11).

const rowSelect = {
  id: true,
  key: true,
  question: true,
  answer: true,
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

  const faqs = await getPrisma().faqItem.findMany({
    orderBy: { key: "asc" },
    select: rowSelect,
  });

  return withRefreshedSession(ok({ faqs }), guard);
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

  const parsed = faqCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  let faq;
  try {
    faq = await getPrisma().faqItem.create({
      data: {
        key: parsed.data.key,
        question: parsed.data.question as object,
        answer: parsed.data.answer as object,
        active: parsed.data.active ?? true,
      },
      select: rowSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "KEY_TAKEN", "Une question existe déjà avec cette clé.");
    }
    throw e;
  }

  revalidateTag("faq", "max");

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "FaqItem",
    faq.id,
    { key: faq.key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ faq }, { status: 201 }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
