"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatClinicLocalTime } from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import AppointmentActions from "./AppointmentActions";
import type { PendingAppointmentRow } from "./appointmentTypes";

// Urgent call queue — top 5 oldest PENDING first (server order kept).
// Reuses GET /api/admin/appointments/pending as-is; countdown derives from
// msRemaining/expiresAt and ticks every 30s. Negative = cron overdue,
// stated explicitly (never a raw "-3 h").

export function expiryLabel(msRemaining: number): string {
  if (msRemaining < 0) return "expiré — le cron va purger";
  const mins = Math.floor(msRemaining / 60000);
  if (mins < 1) return "expire dans moins d'une minute";
  if (mins < 60) return `expire dans ${mins} min`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `expire dans ${h} h` : `expire dans ${h} h ${rest}`;
}

export default function CallQueuePanel() {
  const [rows, setRows] = useState<PendingAppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch("/api/admin/appointments/pending", {
          signal: controller.signal,
        });
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as { appointments: PendingAppointmentRow[] };
        setRows(body.appointments.slice(0, 5));
        setTotal(body.appointments.length);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reloadToken]);

  return (
    <section
      aria-labelledby="queue-heading"
      className="dash-enter rounded-2xl border border-amber-200/70 bg-white p-4 shadow-[0_4px_24px_-12px_rgba(217,119,6,0.35)] sm:p-5"
      style={{ animationDelay: "140ms" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-600" />
          </span>
          <h2 id="queue-heading" className="text-base font-bold text-cyan-950">
            À rappeler
          </h2>
          {!loading && !error && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
              {total}
            </span>
          )}
        </div>
        <Link
          href="/admin/appointments?tab=queue"
          className="cursor-pointer text-xs font-semibold text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          Toute la file →
        </Link>
      </div>

      <div aria-busy={loading} className="mt-3">
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Impossible de charger la file.{" "}
            <button
              type="button"
              onClick={() => setReloadToken((t) => t + 1)}
              className="cursor-pointer font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Réessayer
            </button>
          </p>
        ) : loading ? (
          <ul className="space-y-2" aria-label="Chargement de la file">
            {[0, 1].map((i) => (
              <li key={i} role="status" aria-label="Chargement…" className="dash-skeleton h-14 rounded-xl" />
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p role="status" className="rounded-xl bg-emerald-50 px-3 py-3 text-center text-sm font-medium text-emerald-900 ring-1 ring-emerald-200">
            File vide — beau travail, tout est confirmé.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => (
              <li
                key={a.id}
                className="dash-row space-y-1.5 rounded-xl border border-amber-100 bg-amber-50/40 p-3 transition-all duration-200 hover:-translate-y-px hover:shadow-md"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Link
                    href={`/admin/patients/${a.patient.id}`}
                    className="font-semibold text-slate-900 hover:text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    {a.patient.lastName} {a.patient.firstName}
                  </Link>
                  <a
                    href={`tel:${a.patient.phone.replace(/[\s.]/g, "")}`}
                    className="cursor-pointer rounded-md bg-cyan-700 px-2 py-0.5 text-xs font-bold text-white transition-colors hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                    dir="auto"
                  >
                    Appeler
                  </a>
                  <span className="text-xs text-slate-600">
                    {localized(a.service.name, "fr")} ·{" "}
                    {formatClinicLocalTime(new Date(a.startTime))}
                  </span>
                  <span
                    role="status"
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      a.msRemaining < 0
                        ? "bg-red-100 text-red-900"
                        : a.msRemaining < 3600_000
                          ? "bg-amber-200 text-amber-950"
                          : "bg-white text-slate-700 ring-1 ring-amber-200"
                    }`}
                  >
                    {expiryLabel(a.msRemaining)}
                  </span>
                </div>
                <AppointmentActions
                  appointmentId={a.id}
                  status="PENDING"
                  startTime={a.startTime}
                  onUpdated={() => setReloadToken((t) => t + 1)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
