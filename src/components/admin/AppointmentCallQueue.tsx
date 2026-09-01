"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import AppointmentActions from "./AppointmentActions";
import { SOURCE_LABELS, type PendingAppointmentRow } from "./appointmentTypes";

// Task 14 step 5 — the call queue (GET /api/admin/appointments/pending):
// PENDING bookings, oldest first, each with its auto-expiry countdown. This
// is the receptionist's most frequent job, so it is a single dense list:
// created time, slot, patient, phone, service, countdown, then
// Confirmer/Annuler inline.
//
// The countdown is derived LOCALLY from the fetch-time `msRemaining`
// baseline (ticked every 30 s) — no polling, the read endpoints share one
// rate-limit pool per staff session. "Actualiser" refetches on demand.

interface QueueEntry extends PendingAppointmentRow {
  msRemainingAtFetch: number;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expiré — suppression automatique imminente";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min restantes`;
  if (minutes > 0) return `${minutes} min restantes`;
  return "Moins d'une minute restante";
}

export default function AppointmentCallQueue({ reloadToken }: { reloadToken: number }) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [queueReloadToken, setQueueReloadToken] = useState(0);
  const fetchedAtRef = useRef(0);

  const reload = useCallback(() => setQueueReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch("/api/admin/appointments/pending");
        if (cancelled) return;
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as { appointments: PendingAppointmentRow[] };
        if (cancelled) return;
        const stamp = Date.now();
        fetchedAtRef.current = stamp;
        setEntries(
          body.appointments.map((a) => ({ ...a, msRemainingAtFetch: a.msRemaining })),
        );
        setFetchedAt(stamp);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queueReloadToken, reloadToken]);

  useEffect(() => {
    if (entries.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [entries.length]);

  return (
    <section aria-labelledby="call-queue-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="call-queue-heading" className="text-sm font-medium text-slate-700">
          Réservations en attente d&rsquo;appel — les plus anciennes en premier
        </h2>
        <button
          type="button"
          onClick={reload}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700
            hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Actualiser
        </button>
      </div>

      <div aria-busy={loading}>
        {error ? (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">
              Impossible de charger la file d&rsquo;attente.
            </p>
            <button
              type="button"
              onClick={reload}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
                hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Réessayer
            </button>
          </div>
        ) : loading ? (
          <p className="text-sm text-slate-500" role="status">
            Chargement…
          </p>
        ) : entries.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-500" role="status">
              Aucune réservation en attente. Tout a été traité.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((a) => {
              const remaining = a.msRemainingAtFetch - (now - fetchedAt);
              const urgent = remaining <= 60 * 60_000;
              const created = new Date(a.createdAt);
              const createdLabel =
                toClinicLocalDateString(created).split("-").reverse().join("/") +
                " à " +
                formatClinicLocalTime(created);
              return (
                <li
                  key={a.id}
                  className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="text-xs text-slate-500">Demande du {createdLabel}</span>
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {formatClinicLocalTime(new Date(a.startTime))}
                    </span>
                    <Link
                      href={`/admin/patients/${a.patient.id}`}
                      className="font-medium text-slate-900 hover:underline focus-visible:outline-none
                        focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      {a.patient.lastName} {a.patient.firstName}
                    </Link>
                    <span className="text-slate-600" dir="auto">
                      {a.patient.phone}
                    </span>
                    <span className="text-slate-700">
                      {localized(a.service.name, "fr")}
                    </span>
                    <span className="text-xs text-slate-500">
                      ({a.service.durationMinutes} min · {SOURCE_LABELS[a.source] ?? a.source})
                    </span>
                    <span className="ml-auto">
                      <AppointmentStatusBadge status={a.status} />
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p
                      role="status"
                      className={
                        "text-xs font-medium " +
                        (remaining <= 0 ? "text-red-700" : urgent ? "text-amber-700" : "text-slate-600")
                      }
                    >
                      {formatRemaining(remaining)}
                    </p>
                    <AppointmentActions
                      appointmentId={a.id}
                      status={a.status}
                      startTime={a.startTime}
                      onUpdated={reload}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
