import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { verifySelfServiceToken } from "@/lib/selfservice/tokens";
import { selfServiceTokenErrorResponse } from "@/lib/selfservice/http";
import { parseLocale } from "@/lib/i18n/config";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import {
  formatClinicLocalTime,
  toClinicLocalDateString,
  addClinicDays,
} from "@/lib/time/clinicTime";
import { readClinicInfo } from "@/lib/settings/clinicInfo";
import { readBookingPolicy } from "@/lib/booking/policy";
import { ok, errorResponse } from "@/lib/api/http";

// Rate-limit token lookups (plan.md §Abuse controls): an attacker guessing
// tokens must be slowed. A token is 256 bits of entropy, so this is defense
// in depth rather than the primary control, but it also caps scrapers from a
// single IP.
const LOOKUP_LIMIT = 60;
const LOOKUP_WINDOW_MS = 60 * 60_000;

/**
 * Self-service lookup — MINIMUM DISCLOSURE ONLY (plan.md §Self-service link).
 * The response exposes exactly: service name, date/time, clinic
 * address/phone and the patient's FIRST name. Never the phone, email, birth
 * date, notes, history, documents or any other appointment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const locale = parseLocale(new URL(request.url).searchParams.get("locale"));

  const ip = getClientIp(request.headers);
  if (ip) {
    try {
      await checkRateLimit(`ip:${ip}:self-service-lookup`, {
        limit: LOOKUP_LIMIT,
        windowMs: LOOKUP_WINDOW_MS,
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

  let verified;
  try {
    verified = await verifySelfServiceToken(token);
  } catch (e) {
    const mapped = selfServiceTokenErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }

  const { appointment, patient, service } = verified;
  const [clinic, policy] = await Promise.all([
    readClinicInfo(),
    readBookingPolicy(),
  ]);
  const today = toClinicLocalDateString(new Date());

  return ok({
    appointment: {
      serviceId: service.id,
      serviceName: localized(service.name as LocalizedField, locale),
      durationMinutes: service.durationMinutes,
      startTime: appointment.startTime.toISOString(),
      localDate: toClinicLocalDateString(appointment.startTime),
      localTime: formatClinicLocalTime(appointment.startTime),
    },
    patient: {
      firstName: patient.firstName,
    },
    clinic,
    meta: {
      today,
      maxDate: addClinicDays(today, policy.maxHorizonDays),
    },
  });
}