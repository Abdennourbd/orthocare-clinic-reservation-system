import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { runBroadcast } from "@/lib/messaging/smsCenter";
import { SMS_BROADCAST_RATE_LIMIT } from "@/lib/messaging/rateLimits";
import { broadcastSendSchema } from "@/schemas/sms";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 16 — POST /api/admin/sms/broadcast: send the day-view delay broadcast
// ("today is running X minutes late"), ADMIN-only. runBroadcast owns the
// whole batch lifecycle — audience load, the idempotent SmsBroadcast row
// (P2002 on the unique idempotencyKey returns the existing batch with ZERO
// sends), the sequential dispatcher fan-out, the counters and the SMS_SENT
// audit — so this handler stays a thin gate and never duplicates that logic.
//
// The idempotencyKey comes from the client (a UUID minted when the confirm
// dialog opens): it is what makes a double-clicked "Envoyer" harmless, since
// the retry lands on the same batch row instead of re-messaging the patients.
//
// Same load-bearing handler order as every admin route: requireStaff -> CSRF
// -> rate limit -> Zod -> domain write. A 404 must NEVER precede a 401/403.

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:sms-broadcast`, SMS_BROADCAST_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = broadcastSendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { date: inputDate, delayMinutes, idempotencyKey } = parsed.data;

  // "Today" is the CLINIC's today (Africa/Algiers), not the server's — all
  // date maths goes through lib/time/clinicTime.ts, the only module that
  // knows the timezone (same convention as the appointments day view).
  const date = inputDate ?? toClinicLocalDateString(new Date());

  // The audit happens inside runBroadcast (ids/counters/enums only).
  const result = await runBroadcast({
    date,
    delayMinutes,
    idempotencyKey,
    sentById: guard.user.id,
  });

  return withRefreshedSession(
    ok({
      batchId: result.batchId,
      sentCount: result.sentCount,
      suppressedCount: result.suppressedCount,
      failedCount: result.failedCount,
      alreadySent: result.alreadySent,
      // recipientCount is only meaningful for a fresh batch; on the
      // alreadySent path the stored counters sum back to the recorded
      // audience size, so this stays consistent in both branches.
      recipientCount:
        result.sentCount + result.suppressedCount + result.failedCount,
    }),
    guard,
  );
}
