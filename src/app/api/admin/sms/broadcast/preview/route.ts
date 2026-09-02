import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { previewBroadcast } from "@/lib/messaging/smsCenter";
import { SMS_BROADCAST_PREVIEW_RATE_LIMIT } from "@/lib/messaging/rateLimits";
import { broadcastPreviewSchema } from "@/schemas/sms";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 16 — POST /api/admin/sms/broadcast/preview: audience + sample body for
// the delay-broadcast UI, ADMIN-only (only ADMIN may trigger the send, so only
// ADMIN sees whom it would reach). Pure read: previewBroadcast only loads and
// splits the day's audience, it never writes — no SmsMessage, no SmsBroadcast.
//
// This route is deliberately NOT audited: there is no write and no state
// change, and the audience it returns is what the send route's SMS_SENT audit
// already accounts for (same ruling as a draft that is never posted).
//
// Same load-bearing handler order as every admin route: requireStaff -> CSRF
// -> rate limit -> Zod -> domain read. A 404 must NEVER precede a 401/403.

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(
      `staff:${guard.user.id}:sms-broadcast-preview`,
      SMS_BROADCAST_PREVIEW_RATE_LIMIT,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = broadcastPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  // "Today" is the CLINIC's today (Africa/Algiers), not the server's — all
  // date maths goes through lib/time/clinicTime.ts, the only module that
  // knows the timezone (same convention as the appointments day view).
  const date = parsed.data.date ?? toClinicLocalDateString(new Date());
  const preview = await previewBroadcast(date);

  return withRefreshedSession(
    ok({
      date,
      delayMinutes: parsed.data.delayMinutes,
      recipientCount: preview.recipients.length,
      // Named fields only, startTime as an ISO string for the JSON payload —
      // names/phones are exactly what the UI (Task 8) must show the staff
      // member before they confirm the send.
      recipients: preview.recipients.map((r) => ({
        appointmentId: r.appointmentId,
        patientId: r.patientId,
        firstName: r.firstName,
        lastName: r.lastName,
        startTime: r.startTime.toISOString(),
        phone: r.phone,
      })),
      excluded: preview.excluded,
      sampleBody: preview.sampleBody,
    }),
    guard,
  );
}
