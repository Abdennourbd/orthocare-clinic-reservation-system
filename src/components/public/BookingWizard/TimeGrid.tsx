"use client";

import { useTranslations } from "next-intl";
import { mergeSlots, type SlotDto } from "@/lib/booking/mergeSlots";

export type { SlotDto } from "@/lib/booking/mergeSlots";

type TimeGridProps = {
  /** Clinic-local date label for accessible slot button names. */
  dateLabel: string;
  available: SlotDto[];
  occupied: SlotDto[];
  selectedStartUTC: string | null;
  onSelect: (slot: SlotDto) => void;
};

/**
 * One chronological grid of slots for a day. Available slots are teal
 * buttons; already-reserved slots stay in their natural time position and
 * render red, disabled, with a visible "Reserved" label — state is conveyed
 * by text + the disabled control + line-through, never by color alone.
 */
export default function TimeGrid({
  dateLabel,
  available,
  occupied,
  selectedStartUTC,
  onSelect,
}: TimeGridProps) {
  const t = useTranslations("Booking");
  const merged = mergeSlots(available, occupied);

  if (merged.length === 0) {
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

  return (
    <fieldset>
      <legend className="sr-only">{t("selectSlot")}</legend>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {merged.map((slot) => {
          const reserved = slot.status === "occupied";
          const selected = slot.startUTC === selectedStartUTC;
          if (reserved) {
            return (
              <button
                key={slot.startUTC}
                type="button"
                disabled
                aria-disabled="true"
                aria-label={t("slotReserved", {
                  date: dateLabel,
                  time: slot.localTime,
                })}
                className="flex flex-col items-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium tabular-nums text-red-400 line-through cursor-not-allowed"
              >
                <span>{slot.localTime}</span>
                <span className="text-[0.625rem] font-semibold uppercase tracking-wide not-italic">
                  {t("reservedLabel")}
                </span>
              </button>
            );
          }
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
  );
}
