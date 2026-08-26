"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { clinicNoon } from "@/lib/time/clinicTime";
import RescheduleStep from "./RescheduleStep";
import {
  api,
  cardClass,
  dangerButtonClass,
  errorKey,
  primaryButtonClass,
  secondaryButtonClass,
  type ApiError,
} from "./shared";

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

type Mode = "view" | "confirmCancel" | "reschedule" | "done";

export default function AppointmentManager({ token }: { token: string }) {
  const t = useTranslations("SelfService");
  const locale = useLocale();

  const [lookup, setLookup] = useState<SelfServiceLookup | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [cancelling, setCancelling] = useState(false);
  const [doneAction, setDoneAction] = useState<"cancel" | "reschedule" | null>(
    null,
  );

  // Focus management: move focus to the confirm dialog when it opens and to the
  // success heading when an action completes, so keyboard/screen-reader users
  // aren't left on a removed button.
  const confirmBoxRef = useRef<HTMLDivElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (mode === "confirmCancel") confirmBoxRef.current?.focus();
    if (mode === "done") successHeadingRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    api<SelfServiceLookup>(`/api/appointments/${encodeURIComponent(token)}?locale=${locale}`)
      .then((body) => {
        if (cancelled) return;
        setLookup(body);
      })
      .catch((e: ApiError) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [token, locale]);

  const doCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await api(`/api/appointments/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
      });
      setDoneAction("cancel");
      setMode("done");
    } catch (e) {
      // Unrecoverable for this flow (token dead, network, rate limit) — the
      // top-level error card explains the situation.
      setError(e as ApiError);
      setMode("view");
    } finally {
      setCancelling(false);
    }
  }, [token]);

  const dateLabel = useMemo(() => {
    if (!lookup) return "";
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(clinicNoon(lookup.appointment.localDate));
  }, [lookup, locale]);

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
          <h1
            ref={successHeadingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-zinc-900"
          >
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
          <div
            ref={confirmBoxRef}
            tabIndex={-1}
            role="alertdialog"
            aria-label={t("cancelConfirmTitle")}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMode("view");
            }}
            className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 outline-none"
          >
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
                disabled={cancelling}
                className={dangerButtonClass}
              >
                {cancelling ? t("cancelling") : t("confirmCancel")}
              </button>
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={cancelling}
                className={secondaryButtonClass}
              >
                {t("keepAppointment")}
              </button>
            </div>
          </div>
        )}

        {mode === "reschedule" && (
          <RescheduleStep
            token={token}
            serviceId={lookup.appointment.serviceId}
            today={lookup.meta.today}
            maxDate={lookup.meta.maxDate}
            onDone={() => {
              setDoneAction("reschedule");
              setMode("done");
            }}
            onBack={() => setMode("view")}
            onFatalError={(e) => setError(e)}
          />
        )}
      </div>
    </div>
  );
}