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
import { CONTENT_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { faqPatchSchema } from "@/schemas/content";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — PATCH + DELETE for /api/admin/faqs/[id]. ADMIN-only.

const rowSelect = {
  id: true,
  key: true,
  question: true,
  answer: true,
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
  const parsed = faqPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const existing = await getPrisma().faqItem.findUnique({
    where: { id },
    select: { id: true, key: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Question introuvable.");
  }

  if (parsed.data.key && parsed.data.key !== existing.key) {
    const clash = await getPrisma().faqItem.findUnique({
      where: { key: parsed.data.key },
      select: { id: true },
    });
    if (clash) {
      return errorResponse(409, "KEY_TAKEN", "Une question existe déjà avec cette clé.");
    }
  }

  let faq;
  try {
    faq = await getPrisma().faqItem.update({
      where: { id },
      data: {
        ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
        ...(parsed.data.question !== undefined ? { question: parsed.data.question as object } : {}),
        ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer as object } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
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

  return withRefreshedSession(ok({ faq }), guard);
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
  const existing = await getPrisma().faqItem.findUnique({
    where: { id },
    select: { id: true, key: true },
  });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Question introuvable.");
  }

  await getPrisma().faqItem.delete({ where: { id } });
  revalidateTag("faq", "max");

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "FaqItem",
    id,
    { key: existing.key, deleted: true },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ deleted: true }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
