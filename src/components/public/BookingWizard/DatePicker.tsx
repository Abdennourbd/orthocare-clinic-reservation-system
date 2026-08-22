"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";

type DatePickerProps = {
  today: string;
  maxDate: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
};

/**
 * Day selection for the booking wizard: a horizontal strip of the next 14
 * days (buttons — keyboard accessible) plus a native date input for dates
 * further out, both bounded to the booking window.
 */
export default function DatePicker({
  today,
  maxDate,
  selectedDate,
  onSelect,
}: DatePickerProps) {
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
    () => Array.from({ length: 14 }, (_, i) => addClinicDays(today, i)),
    [today],
  );

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label={t("chooseDate")}
        className="flex gap-2 overflow-x-auto pb-2"
      >
        {strip.map((d) => {
          const disabled = d < today || d > maxDate;
          const selected = d === selectedDate;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={dayFmt.format(clinicNoon(d))}
              onClick={() => onSelect(d)}
              className={`shrink-0 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                disabled
                  ? "cursor-not-allowed border-zinc-200 text-zinc-300"
                  : selected
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-zinc-300 text-zinc-700 hover:border-teal-400 hover:text-teal-700"
              }`}
            >
              {dayFmt.format(clinicNoon(d))}
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
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}