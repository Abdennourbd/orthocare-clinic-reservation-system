"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { clinicNoon } from "@/lib/time/clinicTime";
import { rescheduleSchema } from "@/schemas/selfService";
import TimeGrid, { type SlotDto } from "@/components/public/BookingWizard/TimeGrid";
import {
  api,
  errorKey,
  primaryButtonClass,
  secondaryButtonClass,
  type ApiError,
} from "./shared";

type SlotResponse = { available: SlotDto[]; occupied: SlotDto[] };

type RescheduleStepProps = {
  token: string;
  serviceId: string;
  /** Clinic-local today (YYYY-MM-DD) and max bookable date — bounds the native
   * date picker. Server-side policy is re-checked by the reschedule route. */
  today: string;
  maxDate: string;
  onDone: () => void;
  onBack: () => void;
  /** Unrecoverable (e.g. token expired/used while rescheduling) — the parent
   * shows the top-level error card. */
  onFatalError: (e: ApiError) => void;
};

/**
 * The reschedule picker: choose a day, see that day's slots (available +
 * occupied), pick an available time and confirm the move.
 *
 * A `SLOT_CONFLICT` (someone took the slot in the milliseconds since it was
 * rendered) is handled INLINE: the message shows next to the grid, the
 * selection clears and the day's slots reload so the taken slot appears as
 * occupied — the patient can simply pick another time instead of hitting a
 * dead end.
 */
export default function RescheduleStep({
  token,
  serviceId,
  today,
  maxDate,
  onDone,
  onBack,
  onFatalError,
}: RescheduleStepProps) {
  const t = useTranslations("SelfService");
  const locale = useLocale();

  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<SlotResponse | null>(null);
  // The initial load for `today` starts in the mount effect, so loading is
  // `true` from the start.
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<ApiError | null>(null);
  const [selectedStartUTC, setSelectedStartUTC] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  // Mirrors `date` so an async slot fetch knows which day to render. Without
  // this, a slow response for a previous date could overwrite the slots of the
  // date the user has since switched to.
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  /** Pure fetch of one day's slots — no state writes, so it is safe to call
   * from an effect and have the effect apply the result in `.then` callbacks
   * (the React-recommended fetch-on-mount pattern). */
  const getSlots = useCallback(
    (d: string) =>
      api<SlotResponse>(
        `/api/slots?serviceId=${encodeURIComponent(serviceId)}&date=${d}&locale=${locale}`,
      ),
    [serviceId, locale],
  );

  /** Apply a fresh response for `d`, dropping it if the user has since moved
   * to another date (stale-response guard). */
  const applySlots = useCallback(
    (d: string, body: SlotResponse) => {
      if (d !== dateRef.current) return;
      setSlots(body);
      setSlotsError(null);
      setSlotsLoading(false);
    },
    [],
  );

  const applySlotsError = useCallback(
    (d: string, e: ApiError) => {
      if (d !== dateRef.current) return;
      setSlotsError(e);
      setSlotsLoading(false);
    },
    [],
  );

  // Initial load for `today` — setState happens in the `.then`/`.catch`
  // callbacks, not synchronously in the effect body.
  useEffect(() => {
    let ignore = false;
    getSlots(today)
      .then((body) => {
        if (ignore) return;
        applySlots(today, body);
      })
      .catch((e: ApiError) => {
        if (ignore) return;
        applySlotsError(today, e);
      });
    return () => {
      ignore = true;
    };
  }, [today, getSlots, applySlots, applySlotsError]);

  /** Event-driven load: reset the picker state and fetch `d`. The synchronous
   * resets live in the event handler, not an effect. */
  const beginLoad = useCallback(
    (d: string) => {
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots(null);
      setSelectedStartUTC(null);
      getSlots(d)
        .then((body) => applySlots(d, body))
        .catch((e: ApiError) => applySlotsError(d, e));
    },
    [getSlots, applySlots, applySlotsError],
  );

  const onDateChange = (d: string) => {
    setDate(d);
    setActionError(null);
    beginLoad(d);
  };

  const confirm = async () => {
    if (!selectedStartUTC) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const parsed = rescheduleSchema.safeParse({ startTime: selectedStartUTC });
      if (!parsed.success) throw new Error("invalid startTime");
      await api(`/api/appointments/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      onDone();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "SLOT_CONFLICT") {
        // Recoverable: keep the picker open, clear the taken slot and reload
        // the day so it now shows as occupied.
        setActionError(err);
        beginLoad(dateRef.current);
      } else {
        onFatalError(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      {actionError && (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(actionError.code))}
        </p>
      )}

      <div>
        <label
          htmlFor="self-service-date"
          className="mb-1.5 block text-sm font-medium text-zinc-700"
        >
          {t("chooseDate")}
        </label>
        <input
          id="self-service-date"
          type="date"
          value={date}
          min={today}
          max={maxDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        />
      </div>

      {slotsLoading && (
        <p role="status" className="text-sm text-zinc-500">
          {t("loading")}
        </p>
      )}

      {slotsError && (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(slotsError.code))}
        </p>
      )}

      {!slotsLoading && !slotsError && slots && (
        <TimeGrid
          dateLabel={new Intl.DateTimeFormat(locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(clinicNoon(date))}
          available={slots.available}
          occupied={slots.occupied}
          selectedStartUTC={selectedStartUTC}
          onSelect={(slot) => {
            setSelectedStartUTC(slot.startUTC);
            setActionError(null);
          }}
        />
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={submitting || !selectedStartUTC}
          className={primaryButtonClass}
        >
          {submitting ? t("rescheduling") : t("confirmReschedule")}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className={secondaryButtonClass}
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}