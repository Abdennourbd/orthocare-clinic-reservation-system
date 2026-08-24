"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";

type DayPickerProps = {
  today: string;
  maxDate: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
};

/**
 * Day selection for the booking wizard: a non-scrolling strip of the next 7
 * days (keyboard-accessible buttons) plus a native date input for any other
 * day inside the booking window. Selecting a day loads that day's slot grid
 * in the combined "Date & time" step.
 */
export default function DayPicker({
  today,
  maxDate,
  selectedDate,
  onSelect,
}: DayPickerProps) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    [locale],
  );

  const strip = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addClinicDays(today, i)),
    [today],
  );

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label={t("chooseDate")}
        className="grid grid-cols-7 gap-1 sm:gap-2"
      >
        {strip.map((d) => {
          const disabled = d < today || d > maxDate;
          const selected = d === selectedDate;
          const parts = dayFmt.formatToParts(clinicNoon(d));
          const part = (type: string) =>
            parts.find((p) => p.type === type)?.value ?? "";
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={dayFmt.format(clinicNoon(d))}
              onClick={() => onSelect(d)}
              className={`flex flex-col items-center rounded-xl border px-1 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                disabled
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300"
                  : selected
                    ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                    : "border-zinc-300 bg-white text-zinc-800 hover:border-teal-400 hover:text-teal-700 hover:shadow-sm"
              }`}
            >
              <span className="text-[0.625rem] opacity-75 sm:text-xs">
                {part("weekday")}
              </span>
              <span className="mt-0.5 text-base font-semibold leading-6 sm:text-lg">
                {part("day")}
              </span>
              <span className="text-[0.625rem] opacity-75 sm:text-xs">
                {part("month")}
              </span>
              {/* Today marker: always rendered (invisible when not today) so
                  every chip keeps the same height. */}
              <span
                aria-hidden="true"
                className={`mt-1 h-1 w-1 rounded-full ${
                  d === today
                    ? selected
                      ? "bg-white"
                      : "bg-teal-500"
                    : "invisible"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="booking-date" className="text-sm text-zinc-600">
          {t("otherDate")}
        </label>
        <input
          id="booking-date"
          type="date"
          min={today}
          max={maxDate}
          value={selectedDate ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
        />
      </div>
    </div>
  );
}
