import {
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";

// Server-side validation of the cancellation-watch dates (Task 6) submitted
// with a booking. The booking-policy rules (no past dates, within the booking
// horizon) are enforced here — the same rules the slot engine applies to
// slots — so a patient cannot watch a day the clinic would never offer.

export type BookingPolicy = {
  minLeadTimeMinutes: number;
  maxHorizonDays: number;
  pendingExpiryHours: number;
  clinicTimezone: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates clinic-local watch dates against the booking policy.
 *
 * @returns `null` when all dates are acceptable (or none are given), else a
 *   human-readable error string. Duplicate dates are silently deduped.
 */
export function validateWatchDates(
  watchDates: string[] | undefined,
  policy: BookingPolicy,
  nowUTC: Date,
): string | null {
  if (!watchDates || watchDates.length === 0) return null;

  const todayLocal = toClinicLocalDateString(nowUTC);
  const horizonMs = policy.maxHorizonDays * 24 * 60 * 60 * 1000;
  const endOfHorizonMs = nowUTC.getTime() + horizonMs;

  const seen = new Set<string>();
  for (const d of watchDates) {
    if (!DATE_RE.test(d)) return "watchDates must be YYYY-MM-DD";
    if (seen.has(d)) continue;
    seen.add(d);

    if (d < todayLocal) return "watch date in the past";
    const { startUTC } = getClinicDayBoundsUTC(d);
    if (startUTC.getTime() > endOfHorizonMs) {
      return "watch date beyond the booking horizon";
    }
  }

  return null;
}