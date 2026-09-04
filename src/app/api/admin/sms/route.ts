import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { SMS_READ_RATE_LIMIT } from "@/lib/messaging/rateLimits";
import { smsHistoryQuerySchema } from "@/schemas/sms";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 16 — GET /api/admin/sms: the SMS history for the dashboard (ADMIN +
// RECEPTIONIST). Cursor-paginated, filterable by batch / patient / type.
//
// Same load-bearing handler order as every admin route (no CSRF on GET):
// requireStaff -> rate limit -> Zod -> read. A 404 must NEVER precede a
// 401/403.
//
// This read exposes patient-identifying content (message bodies + names), so
// like the patient directory and the day view it IS audited
// (PATIENT_RECORD_VIEWED) — but the audit detail carries ids/enums/counters
// only, never a message body (same ruling as the single-send route).

// GET's row shape: named fields only (never a model spread — a spread leaks
// non-column keys and can serialize PII in a PrismaClientValidationError).
const smsMessageRowSelect = {
  id: true,
  to: true,
  body: true,
  type: true,
  templateId: true,
  batchId: true,
  provider: true,
  status: true,
  error: true,
  sentAt: true,
  createdAt: true,
  patient: { select: { id: true, firstName: true, lastName: true } },
} as const;

const DEFAULT_LIMIT = 50;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:sms-read`, SMS_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = smsHistoryQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { batchId, patientId, type, cursor } = parsedQuery.data;
  const limit = parsedQuery.data.limit ?? DEFAULT_LIMIT;

  // Filters are built ONLY from provided values — an omitted filter must not
  // become a null/is-null constraint. Secondary sort key `id desc`: messages
  // created in the same millisecond need a deterministic order for the
  // cursor walk to be stable (same reasoning as the audit route).
  const messages = await getPrisma().smsMessage.findMany({
    where: {
      ...(batchId ? { batchId } : {}),
      ...(patientId ? { patientId } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: smsMessageRowSelect,
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "SmsMessage",
    "list",
    // Ids, enum and counter only — NEVER a message body or phone number.
    {
      scope: "sms-history",
      resultCount: messages.length,
      ...(batchId ? { batchId } : {}),
      ...(patientId ? { patientId } : {}),
      ...(type ? { type } : {}),
    },
    getClientIp(request.headers),
  );

  // A full page means there may be more; the last row's id is the next
  // page's cursor (skipped via `skip: 1` on the follow-up request).
  return withRefreshedSession(
    ok({
      messages,
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null,
    }),
    guard,
  );
}
