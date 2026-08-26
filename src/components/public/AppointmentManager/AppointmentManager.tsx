"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { clinicNoon } from "@/lib/time/clinicTime";
import { rescheduleSchema } from "@/schemas/selfService";
import TimeGrid, { type SlotDto } from "@/components/public/BookingWizard/TimeGrid";

// Self-service appointment manager (Task 8). Fetch = the min-disclosure GET,
// then cancel / reschedule into an available slot. All requests are to our own
// API — this page deliberately loads NO third-party scripts, because the
// appointment token sits in the URL and must never reach another origin in a
// `Referer` header.

type SelfServiceLookup = {
  appointment: {
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    startTime: string;
    localDate: string;
    localTime: string;
  };
  patient: { firstName: string };
  clinic: { name: string; address: string; phone: string };
  meta: { today: string; maxDate: string };
};

type SlotResponse = { available: SlotDto[]; occupied: SlotDto[] };

type ApiError = Error & { code?: string; status?: number };

type Mode = "view" | "confirmCancel" | "reschedule" | "busy" | "done";

const cardClass =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";

const dangerButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60";

function errorKey(code?: string): string {
  switch (code) {
    case "TOKEN_NOT_FOUND":
      return "errTokenNotFound";
    case "TOKEN_EXPIRED":
      return "errTokenExpired";
    case "TOKEN_USED":
      return "errTokenUsed";
    case "TOKEN_REVOKED":
      return "errTokenRevoked";
    case "APPOINTMENT_UNAVAILABLE":
      return "errAppointmentUnavailable";
    case "RATE_LIMITED":
      return "errRateLimited";
    case "SLOT_CONFLICT":
      return "errConflict";
    default:
      return "errGeneric";
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (body as { error?: { message?: string } }).error?.message ??
        `HTTP ${res.status}`,
    ) as ApiError;
    err.code = (body as { error?: { code?: string } }).error?.code;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export default function AppointmentManager({ token }: { token: string }) {
  const t = useTranslations("SelfService");
  const locale = useLocale();

  const [lookup, setLookup] = useState<SelfServiceLookup | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [busyAction, setBusyAction] = useState<"cancel" | "reschedule" | null>(
    null,
  );
  const [doneAction, setDoneAction] = useState<"cancel" | "reschedule" | null>(
    null,
  );
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotResponse | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<ApiError | null>(null);
  const [selectedStartUTC, setSelectedStartUTC] = useState<string | null>(null);

  /** Fetch one day's slots for the reschedule picker. */
  const loadSlotsFor = useCallback(
    async (data: SelfServiceLookup, d: string) => {
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots(null);
      setSelectedStartUTC(null);
      try {
        const body = await api<SlotResponse>(
          `/api/slots?serviceId=${encodeURIComponent(data.appointment.serviceId)}&date=${d}&locale=${locale}`,
        );
        setSlots(body);
      } catch (e) {
        setSlotsError(e as ApiError);
      } finally {
        setSlotsLoading(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    api<SelfServiceLookup>(`/api/appointments/${encodeURIComponent(token)}?locale=${locale}`)
      .then((body) => {
        if (cancelled) return;
        setLookup(body);
        setDate(body.meta.today);
        void loadSlotsFor(body, body.meta.today);
      })
      .catch((e: ApiError) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [token, locale, loadSlotsFor]);

  const onDateChange = (d: string) => {
    setDate(d);
    if (lookup) void loadSlotsFor(lookup, d);
  };

  const dateLabel = useMemo(() => {
    if (!lookup) return "";
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(clinicNoon(lookup.appointment.localDate));
  }, [lookup, locale]);

  const doCancel = async () => {
    setBusyAction("cancel");
    try {
      await api(`/api/appointments/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
      });
      setDoneAction("cancel");
      setMode("done");
    } catch (e) {
      setError(e as ApiError);
      setMode("view");
    } finally {
      setBusyAction(null);
    }
  };

  const doReschedule = async () => {
    if (!selectedStartUTC) return;
    setBusyAction("reschedule");
    try {
      const parsed = rescheduleSchema.safeParse({ startTime: selectedStartUTC });
      if (!parsed.success) throw new Error("invalid startTime");
      await api(`/api/appointments/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setDoneAction("reschedule");
      setMode("done");
    } catch (e) {
      setError(e as ApiError);
      setMode("reschedule");
    } finally {
      setBusyAction(null);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className={cardClass}>
          <h1 className="text-2xl font-bold text-zinc-900">{t("title")}</h1>
          <p className="mt-3 text-zinc-600">{t(errorKey(error.code))}</p>
        </div>
      </div>
    );
  }

  if (!lookup) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className={cardClass}>
          <p role="status" className="text-sm text-zinc-600">
            {t("loading")}
          </p>
        </div>
      </div>
    );
  }

  if (mode === "done") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className={cardClass}>
          <h1 className="text-2xl font-bold text-zinc-900">
            {t(
              doneAction === "cancel"
                ? "successCancelTitle"
                : "successRescheduleTitle",
            )}
          </h1>
          <p className="mt-3 text-zinc-600">
            {t(
              doneAction === "cancel"
                ? "successCancelText"
                : "successRescheduleText",
            )}
          </p>
          <p className="mt-2 text-sm text-zinc-500">{t("doneNote")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
        {t("title")}
      </h1>

      <div className={`${cardClass} mt-6`}>
        <p className="text-zinc-600">{t("hello", { firstName: lookup.patient.firstName })}</p>
        <p className="mt-1 text-sm text-zinc-500">{t("intro")}</p>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("service")}</dt>
            <dd className="font-semibold text-zinc-900">
              {lookup.appointment.serviceName}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("date")}</dt>
            <dd className="font-semibold text-zinc-900">{dateLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("time")}</dt>
            <dd className="font-semibold text-zinc-900">
              {lookup.appointment.localTime}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">{t("clinic")}</dt>
            <dd className="text-right text-zinc-900">
              <span className="font-semibold">{lookup.clinic.name}</span>
              <span className="block text-zinc-600">{lookup.clinic.address}</span>
              <span className="block text-zinc-600">{lookup.clinic.phone}</span>
            </dd>
          </div>
        </dl>

        {mode === "view" && (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setMode("confirmCancel")}
              className={dangerButtonClass}
            >
              {t("cancelButton")}
            </button>
            <button
              type="button"
              onClick={() => setMode("reschedule")}
              className={primaryButtonClass}
            >
              {t("rescheduleButton")}
            </button>
          </div>
        )}

        {mode === "confirmCancel" && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-zinc-900">
              {t("cancelConfirmTitle")}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              {t("cancelConfirmText")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void doCancel()}
                disabled={busyAction !== null}
                className={dangerButtonClass}
              >
                {busyAction === "cancel" ? t("cancelling") : t("confirmCancel")}
              </button>
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={busyAction !== null}
                className={secondaryButtonClass}
              >
                {t("keepAppointment")}
              </button>
            </div>
          </div>
        )}

        {mode === "reschedule" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-zinc-600">{t("rescheduleIntro")}</p>

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
                min={lookup.meta.today}
                max={lookup.meta.maxDate}
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
                onSelect={(slot) => setSelectedStartUTC(slot.startUTC)}
              />
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => void doReschedule()}
                disabled={busyAction !== null || !selectedStartUTC}
                className={primaryButtonClass}
              >
                {busyAction === "reschedule"
                  ? t("rescheduling")
                  : t("confirmReschedule")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("view");
                  setError(null);
                }}
                disabled={busyAction !== null}
                className={secondaryButtonClass}
              >
                {t("back")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}