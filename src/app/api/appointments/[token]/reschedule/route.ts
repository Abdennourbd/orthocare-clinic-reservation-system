import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { selfServiceReschedule } from "@/lib/selfservice/actions";
import { selfServiceTokenErrorResponse } from "@/lib/selfservice/http";
import { SlotConflictError } from "@/lib/booking/bookSlot";
import { AppointmentAlreadyReleasedError } from "@/lib/booking/releaseSlot";
import { rescheduleSchema } from "@/schemas/selfService";
import { isSameSiteOrigin } from "@/lib/security/origin";
import { ok, errorResponse } from "@/lib/api/http";

const RESCHEDULE_LIMIT = 30;
const RESCHEDULE_WINDOW_MS = 60 * 60_000;

/**
 * Self-service reschedule: releases the old slot and books the new one
 * atomically (`rescheduleSlot`, so the slot-freed event fires), rotates the
 * token (old revoked, fresh one embedded in the reschedule SMS) and audits
 * with actor PATIENT. Only available slots are accepted — `bookSlotInTx`
 * re-checks availability and policy under the booking advisory lock.
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
      await checkRateLimit(`ip:${ip}:self-service-reschedule`, {
        limit: RESCHEDULE_LIMIT,
        windowMs: RESCHEDULE_WINDOW_MS,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  try {
    const result = await selfServiceReschedule(
      token,
      new Date(parsed.data.startTime),
      ip,
    );
    return ok({
      oldAppointment: {
        id: result.oldAppointment.id,
        status: result.oldAppointment.status,
      },
      newAppointment: {
        id: result.newAppointment.id,
        status: result.newAppointment.status,
        serviceId: result.newAppointment.serviceId,
        startTime: result.newAppointment.startTime.toISOString(),
      },
    });
  } catch (e) {
    const mapped = selfServiceTokenErrorResponse(e);
    if (mapped) return mapped;
    if (e instanceof SlotConflictError) {
      return errorResponse(409, "SLOT_CONFLICT", e.message);
    }
    if (e instanceof AppointmentAlreadyReleasedError) {
      return errorResponse(409, "ALREADY_RELEASED", e.message);
    }
    throw e;
  }
}