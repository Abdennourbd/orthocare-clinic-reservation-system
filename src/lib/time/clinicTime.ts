/**
 * Clinic Timezone: Africa/Algiers (UTC+1, no DST).
 * All timestamps are stored in UTC, but the working hours, day boundaries,
 * and slot availability are evaluated in the clinic's local time.
 */

const CLINIC_TIMEZONE = "Africa/Algiers";

/**
 * Returns the UTC instants for the start (00:00:00.000) and end (23:59:59.999)
 * of a given clinic-local date string (YYYY-MM-DD).
 */
export function getClinicDayBoundsUTC(localDateString: string): {
  startUTC: Date;
  endUTC: Date;
} {
  // Construct a Date object from the ISO string with the clinic's fixed offset (+01:00)
  // Africa/Algiers does not observe DST, so the offset is always +01:00.
  const startUTC = new Date(`${localDateString}T00:00:00.000+01:00`);
  const endUTC = new Date(`${localDateString}T23:59:59.999+01:00`);
  return { startUTC, endUTC };
}

/**
 * Converts a UTC Date object to the clinic's local date string (YYYY-MM-DD).
 */
export function toClinicLocalDateString(utcDate: Date): string {
  // Use Intl.DateTimeFormat to reliably format in the clinic timezone.
  // We request numeric parts to build YYYY-MM-DD.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA format is YYYY-MM-DD
  return formatter.format(utcDate);
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Returns the 3-letter weekday for a local date string.
 */
export function getClinicDayOfWeek(localDateString: string): string {
  // Since localDateString is YYYY-MM-DD, parsing it as YYYY-MM-DD or
  // constructing a Date in the clinic's offset gives us the correct Date object
  // whose local (UTC) getUTCDay() matches the local day of week.
  // It's safest to construct the mid-day instant in clinic time:
  const midDayUTC = new Date(`${localDateString}T12:00:00.000+01:00`);
  return WEEKDAYS[midDayUTC.getUTCDay()];
}
