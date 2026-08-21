import { getClinicDayOfWeek } from "../time/clinicTime";

export type DayWorkingHours =
  | { closed: true }
  | { open: string; close: string };

export type WorkingHoursSetting = {
  [day in "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"]?: DayWorkingHours;
};

export function parseHHmmToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(":");
  return parseInt(hh, 10) * 60 + parseInt(mm, 10);
}

/**
 * Parses the setting JSON into `openMinutes` and `closeMinutes` since midnight.
 * Returns null if the day is closed or not configured.
 */
export function getWorkingHoursForDay(
  localDateString: string,
  settingValue: unknown,
): { openMinutes: number; closeMinutes: number } | null {
  const dayOfWeek = getClinicDayOfWeek(localDateString);
  const dayConfig = (settingValue as WorkingHoursSetting)[dayOfWeek as keyof WorkingHoursSetting];

  if (!dayConfig) return null;
  if ("closed" in dayConfig && dayConfig.closed) return null;
  if ("open" in dayConfig && "close" in dayConfig) {
    return {
      openMinutes: parseHHmmToMinutes(dayConfig.open),
      closeMinutes: parseHHmmToMinutes(dayConfig.close),
    };
  }

  return null;
}
