"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import AppointmentActions from "./AppointmentActions";
import { SOURCE_LABELS, type AppointmentRow } from "./appointmentTypes";

// Task 14 step 5 — the day view (GET /api/admin/appointments?date=…): one
// clinic-local day, sorted by time (the API orders startTime asc). The date
// input defaults to the CLINIC's today (toClinicLocalDateString), never the
// viewer's browser timezone. An optional status filter maps 1:1 onto the
// API's `status` query parameter. Dense but readable: one row per
// appointment, actions inline via AppointmentActions.

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tous les statuts" },
  { value: "PENDING", label: "En attente" },
  { value: "CONFIRMED", label: "Confirmés" },
  { value: "COMPLETED", label: "Terminés" },
  { value: "NO_SHOW", label: "Absents" },
  { value: "CANCELLED", label: "Annulés" },
  { value: "RESCHEDULED", label: "Reportés" },
];

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export default function AppointmentDayView({ reloadToken }: { reloadToken: number }) {
  const [dateInput, setDateInput] = useState(() => toClinicLocalDateString(new Date()));
  const [date, setDate] = useState(() => toClinicLocalDateString(new Date()));
  const [statusFilter, setStatusFilter] = useState("");
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [listReloadToken, setListReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ date });
      if (statusFilter) params.set("status", statusFilter);
      try {
        const response = await fetch(`/api/admin/appointments?${params.toString()}`);
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
  }, [date, statusFilter, listReloadToken, reloadToken]);

  const reload = () => setListReloadToken((t) => t + 1);
  const dayLabel = date.split("-").reverse().join("/");

  return (
    <section aria-labelledby="day-view-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="day-view-date" className="block text-xs font-medium text-slate-600">
              Jour (heure du cabinet)
            </label>
            <input
              id="day-view-date"
              type="date"
              value={dateInput}
              onChange={(e) => {
                setDateInput(e.target.value);
                if (e.target.value) setDate(e.target.value);
              }}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="day-view-status" className="block text-xs font-medium text-slate-600">
              Statut
            </label>
            <select
              id="day-view-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={inputClass}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={reload}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Actualiser
          </button>
        </div>
        <h2 id="day-view-heading" className="text-sm font-medium text-slate-700">
          Agenda du {dayLabel}
        </h2>
      </div>

      <div aria-busy={loading}>
        {error ? (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">
              Impossible de charger les rendez-vous du jour.
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
        ) : appointments.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-500" role="status">
              Aucun rendez-vous ce jour.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {appointments.map((a) => {
              const start = new Date(a.startTime);
              const end = new Date(a.endTime);
              return (
                <li
                  key={a.id}
                  className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {formatClinicLocalTime(start)}–{formatClinicLocalTime(end)}
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
    </section>
  );
}
