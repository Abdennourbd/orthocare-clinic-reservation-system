"use client";

import { useTranslations } from "next-intl";

export type SlotDto = { startUTC: string; localTime: string };

type SlotPickerProps = {
  /** Clinic-local date label for accessible slot button names. */
  dateLabel: string;
  available: SlotDto[];
  occupied: SlotDto[];
  selectedStartUTC: string | null;
  onSelect: (slot: SlotDto) => void;
};

/**
 * The slot grid of the booking wizard. Available slots are buttons; occupied
 * (already-reserved) slots are disabled buttons, so both the state and the
 * interaction are keyboard-accessible and screen-reader friendly. Every button
 * carries a full "date, time — available/reserved" label, not just a number.
 */
export default function SlotPicker({
  dateLabel,
  available,
  occupied,
  selectedStartUTC,
  onSelect,
}: SlotPickerProps) {
  const t = useTranslations("Booking");

  if (available.length === 0 && occupied.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="h-6 w-6 text-zinc-400"
        >
          <rect
            x="3"
            y="5"
            width="18"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M3 10h18M8 3v4M16 3v4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm text-zinc-600">{t("noSlots")}</p>
      </div>
    );
  }

  const grid = "mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5";

  return (
    <div className="space-y-4">
      {available.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700">
            {t("availableSlots")}
          </legend>
          <div className={grid}>
            {available.map((slot) => {
              const selected = slot.startUTC === selectedStartUTC;
              return (
                <button
                  key={slot.startUTC}
                  type="button"
                  aria-pressed={selected}
                  aria-label={t("slotAvailable", {
                    date: dateLabel,
                    time: slot.localTime,
                  })}
                  onClick={() => onSelect(slot)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                    selected
                      ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                      : "border-teal-200 bg-teal-50 text-teal-800 hover:border-teal-400 hover:bg-teal-100 hover:shadow-sm"
                  }`}
                >
                  {slot.localTime}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {occupied.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-zinc-400">
            {t("reservedSlots")}
          </legend>
          <div className={grid}>
            {occupied.map((slot) => (
              <button
                key={slot.startUTC}
                type="button"
                disabled
                aria-label={t("slotReserved", {
                  date: dateLabel,
                  time: slot.localTime,
                })}
                className="cursor-not-allowed rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium tabular-nums text-zinc-300 line-through"
              >
                {slot.localTime}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}