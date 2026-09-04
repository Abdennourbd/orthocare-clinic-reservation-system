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
  SETTINGS_READ_RATE_LIMIT,
  SETTINGS_WRITE_RATE_LIMIT,
} from "@/lib/content/rateLimits";
import { settingsPatchSchema } from "@/schemas/settings";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/messaging/templates";
import { AuditAction, AuditActorType, type Prisma } from "@/generated/prisma/client";

// Task 21 — GET (all editable settings) + PATCH (single-key update) for
// /api/admin/settings. ADMIN-only.
//
// The slot engine (loadSlotContext), the expiry cron (readBookingPolicy)
// and the SMS Center (readMessageTemplate) read these rows live — a PATCH
// takes effect on the next engine/cron/send call, no restart, no cache.
// Validation here is the guardrail: an invalid slotConfig must 400, never
// reach the DB and crash the engine with SlotConfigError.

const EDITABLE_KEYS = ["workingHours", "slotConfig", "bookingPolicy", "messageTemplates", "clinicInfo"] as const;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:settings-read`, SETTINGS_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const rows = await getPrisma().setting.findMany({
    where: { key: { in: [...EDITABLE_KEYS] } },
    select: { key: true, value: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  // messageTemplates merges over the built-in defaults so the dashboard
  // always shows the effective text (seed may only carry a subset).
  const storedTemplates = (byKey.get("messageTemplates")?.value ?? {}) as Record<string, unknown>;
  const messageTemplates: Record<string, string> = { ...DEFAULT_MESSAGE_TEMPLATES };
  for (const [k, v] of Object.entries(storedTemplates)) {
    if (typeof v === "string" && v.length > 0) messageTemplates[k] = v;
  }

  return withRefreshedSession(
    ok({
      settings: {
        workingHours: byKey.get("workingHours")?.value ?? null,
        slotConfig: byKey.get("slotConfig")?.value ?? null,
        bookingPolicy: byKey.get("bookingPolicy")?.value ?? null,
        messageTemplates,
        clinicInfo: byKey.get("clinicInfo")?.value ?? null,
      },
    }),
    guard,
  );
}

export async function PATCH(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:settings-write`, SETTINGS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = settingsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { key, value } = parsed.data;

  // messageTemplates PATCH merges (partial record) — a missing key keeps its
  // current value, never wiped. Every other key replaces wholesale.
  let storedValue: Prisma.InputJsonValue;
  if (key === "messageTemplates") {
    const current = await getPrisma().setting.findUnique({ where: { key } });
    const prev = (current?.value ?? {}) as Record<string, unknown>;
    storedValue = { ...prev, ...value } as Prisma.InputJsonValue;
  } else {
    storedValue = value as Prisma.InputJsonValue;
  }

  await getPrisma().setting.upsert({
    where: { key },
    update: { value: storedValue },
    create: { key, value: storedValue },
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.SETTINGS_UPDATED,
    "Setting",
    key,
    // Key + scalar summary only — never full template bodies.
    { key },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ updated: true, key }), guard);
}
