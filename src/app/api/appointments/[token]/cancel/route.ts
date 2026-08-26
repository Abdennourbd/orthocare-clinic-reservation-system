import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { selfServiceCancel } from "@/lib/selfservice/actions";
import { selfServiceTokenErrorResponse } from "@/lib/selfservice/http";
import { AppointmentAlreadyReleasedError } from "@/lib/booking/releaseSlot";
import { isSameSiteOrigin } from "@/lib/security/origin";
import { ok, errorResponse } from "@/lib/api/http";

const CANCEL_LIMIT = 30;
const CANCEL_WINDOW_MS = 60 * 60_000;

/**
 * Self-service cancel: frees the slot via `releaseSlot()` (so the slot-freed
 * event fires for the waitlist), marks the single-use token consumed, messages
 * the patient, notifies staff and audits with actor PATIENT.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (!isSameSiteOrigin(request)) {
    return errorResponse(403, "FORBIDDEN_ORIGIN", "Cross-site request is not allowed.");
  }

  const { token } = await params;
  const ip = getClientIp(request.headers);
  if (ip) {
    try {
      await checkRateLimit(`ip:${ip}:self-service-cancel`, {
        limit: CANCEL_LIMIT,
        windowMs: CANCEL_WINDOW_MS,
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        return errorResponse(429, "RATE_LIMITED", e.message, {
          "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)),
        });
      }
      throw e;
    }
  }

  try {
    const { appointment } = await selfServiceCancel(token, ip);
    return ok({
      appointment: {
        id: appointment.id,
        status: appointment.status,
        cancelReason: appointment.cancelReason,
        startTime: appointment.startTime.toISOString(),
      },
    });
  } catch (e) {
    const mapped = selfServiceTokenErrorResponse(e);
    if (mapped) return mapped;
    if (e instanceof AppointmentAlreadyReleasedError) {
      return errorResponse(409, "ALREADY_RELEASED", e.message);
    }
    throw e;
  }
}