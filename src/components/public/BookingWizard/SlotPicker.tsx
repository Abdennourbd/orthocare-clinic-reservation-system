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
      <p role="status" className="text-sm text-zinc-600">
        {t("noSlots")}
      </p>
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
                  className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                    selected
                      ? "border-teal-600 bg-teal-600 text-white"
                      : "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100"
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
          <legend className="text-sm font-medium text-zinc-500">
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
                className="cursor-not-allowed rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-400 line-through"
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