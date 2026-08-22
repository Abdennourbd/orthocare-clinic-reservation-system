import { getPrisma } from "@/lib/db";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { loadDaySlotContext } from "@/lib/booking/loadSlotContext";
import { ServiceNotFoundError } from "@/lib/booking/errors";
import { getDaySlotOverview } from "@/lib/slots/engine";
import { parseLocale } from "@/lib/i18n/config";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { formatClinicLocalTime } from "@/lib/time/clinicTime";
import { ok, errorResponse } from "@/lib/api/http";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Available + occupied slots for a service on a clinic-local date.
 *
 * `available` are the slots offered for booking (the booking wizard renders
 * them as buttons); `occupied` are candidate times inside working hours that
 * are already taken (rendered as reserved). Slots blocked only by the booking
 * policy (lead time, horizon, past, lunch) appear in neither list.
 *
 * The engine's re-check (Task 5 bookSlot) uses the exact same rules, so a slot
 * shown here as available is bookable — modulo a just-happened race, which the
 * POST route surfaces as a 409.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const date = url.searchParams.get("date");
  const locale = parseLocale(url.searchParams.get("locale"));

  if (!serviceId) {
    return errorResponse(400, "MISSING_SERVICE_ID", "serviceId is required");
  }
  if (!date || !DATE_RE.test(date)) {
    return errorResponse(400, "INVALID_DATE", "date must be YYYY-MM-DD");
  }

  const ip = getClientIp(request.headers);
  if (ip) {
    try {
      // Lighter limit than booking: browsing many dates is cheap.
      await checkRateLimit(`ip:${ip}:slots`, { limit: 120, windowMs: 60_000 });
    } catch (e) {
      if (e instanceof RateLimitError) {
        return errorResponse(429, "RATE_LIMITED", e.message, {
          "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)),
        });
      }
      throw e;
    }
  }

  const nowUTC = new Date();
  let service;
  let engineInput;
  try {
    ({ service, engineInput } = await getPrisma().$transaction((tx) =>
      loadDaySlotContext(tx, { serviceId, localDateString: date, nowUTC }),
    ));
  } catch (e) {
    // Only a missing/inactive service is a 404; anything else (DB outage,
    // bad slot config) must surface as a real error, not be masked.
    if (e instanceof ServiceNotFoundError) {
      return errorResponse(404, "SERVICE_NOT_FOUND", "Service not found");
    }
    throw e;
  }
  if (!service.active) {
    return errorResponse(404, "SERVICE_NOT_FOUND", "Service not found");
  }

  const overview = getDaySlotOverview(engineInput);
  const toDto = (d: Date) => ({
    startUTC: d.toISOString(),
    localTime: formatClinicLocalTime(d),
  });

  return ok({
    service: {
      id: service.id,
      slug: service.slug,
      name: localized(service.name as LocalizedField, locale),
      durationMinutes: service.durationMinutes,
    },
    date,
    available: overview.available.map(toDto),
    occupied: overview.occupied.map(toDto),
  });
}