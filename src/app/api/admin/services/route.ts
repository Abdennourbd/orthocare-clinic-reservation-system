import { NextRequest } from "next/server";
import { revalidateTagSafe } from "@/lib/cache/revalidate";
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
import { serviceCreateSchema } from "@/schemas/services";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 21 — GET (list) + POST (create) for /api/admin/services.
// ADMIN-only (least privilege — plan.md §Auth/RBAC).
//
// Order is load-bearing: requireStaff -> (CSRF, on POST) -> rate limit ->
// Zod -> domain checks -> DB write. A 400/404/409 must NEVER precede a
// 401/403. Named-field selects only.

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

  const services = await getPrisma().service.findMany({
    orderBy: [{ active: "desc" }, { slug: "asc" }],
    select: serviceRowSelect,
  });

  return withRefreshedSession(ok({ services }), guard);
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

  const parsed = serviceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { slug, name, description, durationMinutes, price, currency } = parsed.data;

  // Check-then-act with a unique-index arbiter: two concurrent creates with
  // the same slug both pass the lookup — P2002 maps back to the same 409.
  let service;
  try {
    service = await getPrisma().service.create({
      data: {
        slug,
        name: name as object,
        description: description as object,
        durationMinutes,
        price: price ?? null,
        currency: currency ?? "DZD",
        active: true,
      },
      select: serviceRowSelect,
    });
    revalidateTagSafe("services", "max");
  } catch (e) {
    if (isUniqueViolation(e)) {
      return errorResponse(409, "SLUG_TAKEN", "Un service existe déjà avec ce slug.");
    }
    throw e;
  }

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "Service",
    service.id,
    // Ids + scalar only — never the localized bodies.
    { slug: service.slug, durationMinutes: service.durationMinutes },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ service }, { status: 201 }), guard);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
