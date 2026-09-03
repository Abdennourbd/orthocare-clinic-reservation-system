/**
 * Clinic Timezone: Africa/Algiers (UTC+1, no DST).
 * All timestamps are stored in UTC, but the working hours, day boundaries,
 * and slot availability are evaluated in the clinic's local time.
 *
 * Per plan.md §Timezone and §Code Structure #11, this module is the ONLY
 * place that knows the clinic timezone and does date maths on local time.
 */

export const CLINIC_TIMEZONE = "Africa/Algiers";

/**
 * The clinic's fixed offset from UTC, in minutes. Africa/Algiers has no DST,
 * so this is constant. Centralised here so it is defined exactly once.
 */
export const CLINIC_UTC_OFFSET_MINUTES = 60;

/**
 * Formats an offset-in-minutes into the +/-HH:MM string suffix used by
 * the ISO parser, e.g. 60 -> "+01:00".
 */
function formatOffsetHHmm(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Returns the UTC instants for the start (00:00:00.000) and end (23:59:59.999)
 * of a given clinic-local date string (YYYY-MM-DD).
 */
export function getClinicDayBoundsUTC(localDateString: string): {
  startUTC: Date;
  endUTC: Date;
} {
  const offset = formatOffsetHHmm(CLINIC_UTC_OFFSET_MINUTES);
  const startUTC = new Date(`${localDateString}T00:00:00.000${offset}`);
  const endUTC = new Date(`${localDateString}T23:59:59.999${offset}`);
  return { startUTC, endUTC };
}

/**
 * Converts a UTC Date object to the clinic's local date string (YYYY-MM-DD).
 */
export function toClinicLocalDateString(utcDate: Date): string {
  // Use Intl.DateTimeFormat to reliably format in the clinic timezone.
  // en-CA formats as YYYY-MM-DD.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(utcDate);
}

/**
 * Formats a UTC instant as clinic-local "HH:mm" (e.g. "10:00"). Used when a
 * slot's start time must be shown in the clinic's time regardless of the
 * viewer's browser timezone (the slots API returns both UTC and this string).
 */
export function formatClinicLocalTime(utcDate: Date): string {
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLINIC_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(utcDate);
}

/**
 * Converts a clinic-local date (YYYY-MM-DD) + time of day (HH:mm) into the
 * corresponding UTC instant, or null when either input is malformed. Used by
 * the front-desk forms (manual booking, reschedule) so a wall-clock time the
 * receptionist picks in clinic-local terms lands on the correct UTC instant —
 * this module stays the only place that knows the timezone.
 */
export function clinicLocalToUTC(
  localDateString: string,
  timeHHmm: string,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDateString)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeHHmm)) return null;
  const offset = formatOffsetHHmm(CLINIC_UTC_OFFSET_MINUTES);
  const date = new Date(`${localDateString}T${timeHHmm}:00.000${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Returns the clinic-local date string `days` days after the given
 * clinic-local date string (negative for earlier). Used for date-strip and
 * booking-window arithmetic in the booking wizard.
 */
export function addClinicDays(localDateString: string, days: number): string {
  const { startUTC } = getClinicDayBoundsUTC(localDateString);
  return toClinicLocalDateString(
    new Date(startUTC.getTime() + days * 86400_000),
  );
}

/**
 * Returns the clinic-local noon instant for a clinic-local date string — a
 * time-of-day safely inside the same local day, useful for formatting a date
 * label without hitting a midnight boundary.
 */
export function clinicNoon(localDateString: string): Date {
  const { startUTC } = getClinicDayBoundsUTC(localDateString);
  return new Date(startUTC.getTime() + 12 * 3600_000);
}

/**
 * Returns the 3-letter weekday for a local date string.
 */
export function getClinicDayOfWeek(localDateString: string): string {
  // Noon local is safely within the same local day for any sane timezone.
  // Africa/Algiers has no DST so the offset is always CLINIC_UTC_OFFSET_MINUTES.
  const offset = formatOffsetHHmm(CLINIC_UTC_OFFSET_MINUTES);
  const midDayUTC = new Date(`${localDateString}T12:00:00.000${offset}`);
  return WEEKDAYS[midDayUTC.getUTCDay()];
}
