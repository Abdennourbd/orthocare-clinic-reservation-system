import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { bookingInputSchema } from "@/schemas/booking";
import { normalizePhoneE164 } from "@/lib/phone/normalize";
import { createBooking } from "@/lib/booking/createBooking";
import { SlotConflictError, PendingLimitError } from "@/lib/booking/bookSlot";
import { validateWatchDates } from "@/lib/booking/watchDates";
import { readBookingPolicy, readConsentVersion } from "@/lib/booking/policy";
import { ok, errorResponse } from "@/lib/api/http";
import { isSameSiteOrigin } from "@/lib/security/origin";

// Abuse controls (plan.md §Abuse controls): the two unauthenticated public
// write paths are rate-limited. Booking is limited per IP and per phone, and
// a phone may only hold a small number of simultaneous PENDING bookings so a
// script cannot fill the calendar.
const IP_LIMIT = 20;
const IP_WINDOW_MS = 60 * 60_000;
const PHONE_LIMIT = 5;
const PHONE_WINDOW_MS = 60 * 60_000;
const MAX_ACTIVE_PENDING_PER_PHONE = 3;

function rateLimited(e: RateLimitError): Response {
  return errorResponse(429, "RATE_LIMITED", e.message, {
    "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)),
  });
}

/**
 * Creates a PENDING online booking. Validates the input with the shared Zod
 * schema, normalizes the phone to E.164, applies the per-IP / per-phone rate
 * limits and the active-PENDING cap, verifies the consent version, validates
 * any cancellation-watch dates against the booking policy, and then creates
 * the appointment (+ patient, + optional PATIENT waitlist entry) atomically.
 */
export async function POST(request: Request): Promise<Response> {
  // 0. CSRF/origin guard: a state-changing public POST must come from the
  // site's own origin. Browsers send `Origin` on every cross-origin POST and
  // on same-origin POSTs; a mismatched (or cross-site) origin is rejected.
  if (!isSameSiteOrigin(request)) {
    return errorResponse(403, "FORBIDDEN_ORIGIN", "Cross-site booking is not allowed.");
  }

  // 1. Per-IP rate limit. getClientIp() reads only trusted proxy headers, so
  // a forged x-forwarded-for cannot mint a fresh identity and bypass this.
  const ip = getClientIp(request.headers);
  if (ip) {
    try {
      await checkRateLimit(`ip:${ip}:appointments`, {
        limit: IP_LIMIT,
        windowMs: IP_WINDOW_MS,
      });
    } catch (e) {
      if (e instanceof RateLimitError) return rateLimited(e);
      throw e;
    }
  }

  // 2. Parse + validate with the schema shared with the booking wizard.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  const parsed = bookingInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  // 3. Normalize the phone to E.164 — the per-phone limit, the PENDING cap,
  // duplicate detection and messaging all key off the normalized value.
  const phoneE164 = normalizePhoneE164(parsed.data.patient.phone);
  if (!phoneE164) {
    return errorResponse(
      422,
      "INVALID_PHONE",
      "Le numéro ne correspond pas à un numéro algérien valide.",
    );
  }

  // 4. Per-phone rate limit.
  try {
    await checkRateLimit(`phone:${phoneE164}:appointments`, {
      limit: PHONE_LIMIT,
      windowMs: PHONE_WINDOW_MS,
    });
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimited(e);
    throw e;
  }

  // 5. Consent must be for the CURRENT version (a stale form cannot book
  // under an outdated consent). The active-PENDING cap is enforced inside
  // createBooking's transaction under a per-phone advisory lock (step 8).
  const consentVersion = await readConsentVersion();
  if (parsed.data.consentVersion !== consentVersion) {
    return errorResponse(
      400,
      "STALE_CONSENT",
      "La version du consentement a changé. Merci de rafraîchir la page et de réserver à nouveau.",
    );
  }

  // 6. Validate the cancellation-watch dates against the booking policy.
  const policy = await readBookingPolicy();
  const watchError = validateWatchDates(parsed.data.watchDates, policy, new Date());
  if (watchError) {
    return errorResponse(400, "INVALID_WATCH_DATES", watchError);
  }

  // 7. Book atomically (patient upsert + slot + optional waitlist entry).
  const startUTC = new Date(parsed.data.startTime);
  try {
    const { appointment, waitlistEntry } = await createBooking({
      serviceId: parsed.data.serviceId,
      startUTC,
      maxActivePending: MAX_ACTIVE_PENDING_PER_PHONE,
      patient: {
        firstName: parsed.data.patient.firstName,
        lastName: parsed.data.patient.lastName,
        phone: parsed.data.patient.phone,
        phoneE164,
        email: parsed.data.patient.email || null,
        birthDate: parsed.data.patient.birthDate
          ? new Date(parsed.data.patient.birthDate)
          : null,
        consentAt: new Date(),
        consentVersion,
      },
      watchDates: parsed.data.watchDates,
    });

    return ok(
      {
        appointment: {
          id: appointment.id,
          status: appointment.status,
          serviceId: appointment.serviceId,
          startTime: appointment.startTime.toISOString(),
        },
        waitlistCreated: waitlistEntry !== null,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof SlotConflictError) {
      return errorResponse(409, "SLOT_CONFLICT", e.message);
    }
    if (e instanceof PendingLimitError) {
      return errorResponse(
        429,
        "PENDING_LIMIT",
        "Vous avez déjà le nombre maximum de demandes en attente. La clinique vous appellera pour les confirmer.",
      );
    }
    throw e;
  }
}