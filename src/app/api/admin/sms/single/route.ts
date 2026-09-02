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
import { sendMessage } from "@/lib/messaging/index";
import { SMS_SEND_RATE_LIMIT } from "@/lib/messaging/rateLimits";
import { singleSmsSchema } from "@/schemas/sms";
import {
  AuditAction,
  AuditActorType,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";

// Task 16 — POST /api/admin/sms/single: one free-text SMS to one patient,
// sent by the front desk (ADMIN + RECEPTIONIST). The free text flows through
// the shared dispatcher (sendMessage) so the opt-out gate, the row lifecycle
// and the provider abstraction cannot be bypassed — the route only decides
// WHO may send and WHAT the message says.
//
// Same load-bearing handler order as the appointments route: requireStaff ->
// CSRF -> rate limit -> Zod -> domain check (404 patient) -> send. A 404 must
// NEVER precede a 401/403.
//
// The response never echoes the body back: it is patient-targeted content the
// sender just typed, and repeating it in the JSON buys the dashboard nothing
// while widening what a logged response leaks.

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:sms-single`, SMS_SEND_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = singleSmsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { patientId, body } = parsed.data;

  // Domain check BEFORE any write: the patient must exist AND be usable — a
  // deactivated or anonymized patient (RGPD soft path) must not receive a
  // staff-written SMS, same rule as a new booking. Only the phone is fetched:
  // the dispatcher owns delivery, the route never touches provider details.
  const patient = await getPrisma().patient.findFirst({
    where: { id: patientId, active: true, anonymizedAt: null },
    select: { id: true, phoneE164: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable ou inactif.");
  }

  // The dispatcher never throws on a provider failure — it records the row
  // with status FAILED and returns it, so this call cannot 500 the route.
  // A null return is type-level possible (the opt-out gate suppresses
  // non-transactional sends) but MANUAL is transactional, so it cannot
  // actually happen here; if it ever did, we still answer 200 `sent: false`
  // and skip the audit (nothing was sent — auditing a non-send would lie).
  const message = await sendMessage({
    type: SmsMessageType.MANUAL,
    patientId: patient.id,
    to: patient.phoneE164,
    bodyOverride: body,
    sentById: guard.user.id,
  });

  if (message !== null) {
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.SMS_SENT,
      "SmsMessage",
      message.id,
      // Ids + enum only — never the body or the phone number.
      { patientId: patient.id, type: "MANUAL", status: message.status },
      getClientIp(request.headers),
    );
  }

  return withRefreshedSession(
    ok(
      message === null
        ? { sent: false }
        : {
            sent: message.status === SmsStatus.SENT,
            messageId: message.id,
            status: message.status,
          },
    ),
    guard,
  );
}
