"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import AppointmentActions from "./AppointmentActions";
import { SOURCE_LABELS, type AppointmentRow } from "./appointmentTypes";

// Task 14 step 5 — appointment search (GET /api/admin/appointments/search?q=…).
// Submit-only, never per-keystroke: the read endpoints share one rate-limit
// pool per staff session and every call is audited (same rationale as
// PatientList). The `q` value stays local state, sent only as a fetch query
// string — never into a URL, title or aria-label.

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export default function AppointmentSearch({ reloadToken }: { reloadToken: number }) {
  const [qInput, setQInput] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [appointments, setAppointments] = useState<AppointmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [listReloadToken, setListReloadToken] = useState(0);

  useEffect(() => {
    if (!submittedQ) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/admin/appointments/search?q=${encodeURIComponent(submittedQ)}`,
        );
        if (cancelled) return;
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as { appointments: AppointmentRow[] };
        if (cancelled) return;
        setAppointments(body.appointments);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submittedQ, listReloadToken, reloadToken]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = qInput.trim();
    if (!q) return;
    setSubmittedQ(q);
  }

  const reload = () => setListReloadToken((t) => t + 1);
  const hasSearched = submittedQ.length > 0;

  return (
    <section aria-labelledby="appointment-search-heading" className="space-y-3">
      <h2 id="appointment-search-heading" className="text-sm font-medium text-slate-700">
        Retrouver un rendez-vous par téléphone ou nom de patient
      </h2>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleSearchSubmit}>
        <div className="space-y-1">
          <label htmlFor="appointment-search-q" className="block text-xs font-medium text-slate-600">
            Téléphone ou nom
          </label>
          <input
            id="appointment-search-q"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            dir="auto"
            autoComplete="off"
            placeholder="ex. Benali ou 0550…"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={!qInput.trim() || loading}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
            hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-60"
        >
          Rechercher
        </button>
      </form>

      {!hasSearched ? (
        <p className="text-sm text-slate-500">Saisissez un critère puis lancez la recherche.</p>
      ) : (
        <div aria-busy={loading}>
          {error ? (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <p role="alert" className="text-sm text-red-700">
                Impossible d&rsquo;effectuer la recherche.
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
          ) : appointments && appointments.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm text-slate-500" role="status">
                Aucun rendez-vous trouvé pour « {submittedQ} ».
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {(appointments ?? []).map((a) => {
                const start = new Date(a.startTime);
                const dateLabel = toClinicLocalDateString(start).split("-").reverse().join("/");
                return (
                  <li
                    key={a.id}
                    className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {dateLabel} {formatClinicLocalTime(start)}
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
                    <AppointmentActions
                      appointmentId={a.id}
                      status={a.status}
                      startTime={a.startTime}
                      onUpdated={reload}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
