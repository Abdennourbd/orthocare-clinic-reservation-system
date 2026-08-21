import { getClinicDayOfWeek } from "../time/clinicTime";

export type DayWorkingHours =
  | { closed: true }
  | { open: string; close: string };

export type WorkingHoursSetting = {
  [day in "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"]?: DayWorkingHours;
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHmmToMinutes(timeStr: string): number {
  if (!HHMM_RE.test(timeStr)) return Number.NaN;
  const [hh, mm] = timeStr.split(":");
  return parseInt(hh, 10) * 60 + parseInt(mm, 10);
}

/**
 * True if `value` is a plain object that can be safely treated as
 * a working-hours day config (either `{closed: true}` or `{open, close}`
 * with valid HH:mm strings and close > open).
 *
 * Working-hours settings come from the DB (admin-editable in Task 21).
 * Treating unknown shapes as trusted has crashed slot generation on
 * malformed rows, so we validate at this boundary.
 */
export function isValidDayConfig(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (v.closed === true) {
    // Closed day — must not also carry open/close.
    return v.open === undefined && v.close === undefined;
  }

  if (typeof v.open === "string" && typeof v.close === "string") {
    const openMin = parseHHmmToMinutes(v.open);
    const closeMin = parseHHmmToMinutes(v.close);
    if (Number.isNaN(openMin) || Number.isNaN(closeMin)) return false;
    if (closeMin <= openMin) return false; // same-minute close is a degenerate day
    return true;
  }

  return false;
}

/**
 * Parses the setting JSON into `openMinutes` and `closeMinutes` since midnight.
 * Returns null if the day is closed, not configured, or malformed.
 */
export function getWorkingHoursForDay(
  localDateString: string,
  settingValue: unknown,
): { openMinutes: number; closeMinutes: number } | null {
  // Defensive: settingValue may be null/undefined/a string/a non-object
  // if the DB row is missing or corrupt. Treat anything we can't read
  // a day key from as "no hours" rather than crashing the slot engine.
  if (settingValue === null || typeof settingValue !== "object") {
    return null;
  }

  const dayOfWeek = getClinicDayOfWeek(localDateString);
  const dayConfig = (settingValue as WorkingHoursSetting)[
    dayOfWeek as keyof WorkingHoursSetting
  ];

  if (!dayConfig) return null;
  if (!isValidDayConfig(dayConfig)) return null;

  if ("closed" in dayConfig && dayConfig.closed) return null;

  const { open, close } = dayConfig as { open: string; close: string };
  return {
    openMinutes: parseHHmmToMinutes(open),
    closeMinutes: parseHHmmToMinutes(close),
  };
}
