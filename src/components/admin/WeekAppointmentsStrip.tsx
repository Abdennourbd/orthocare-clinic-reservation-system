"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addClinicDays,
  CLINIC_TIMEZONE,
  clinicNoon,
  formatClinicLocalTime,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import AppointmentActions from "./AppointmentActions";
import {
  APPOINTMENT_STATUSES,
  STATUS_LABELS,
  SOURCE_LABELS,
  type AppointmentRow,
} from "./appointmentTypes";

// Week strip Sam→Jeu — the dentist's chair view.
// ONE fetch to the range endpoint per (from,to,status); the day filter is
// client-side (no re-fetch, no extra audit/rate-limit draw). Chrono order
// (API sorts startTime asc). Actions reuse AppointmentActions inline.

export interface WeekPatient {
  id: string;
  firstName: string;
  lastName: string;
}

function dayLabel(localDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(clinicNoon(localDate));
}

function shortDay(localDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
  }).format(clinicNoon(localDate));
}

function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  for (let i = 0; i < 35 && cursor <= to; i++) {
    days.push(cursor);
    if (cursor === to) break;
    cursor = addClinicDays(cursor, 1);
  }
  return days;
}

const inputClass =
  "rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm text-cyan-950 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export default function WeekAppointmentsStrip({
  from,
  to,
  today,
  onPatients,
}: {
  from: string;
  to: string;
  today: string;
  onPatients?: (patients: WeekPatient[]) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("all");
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const days = useMemo(() => listDays(from, to), [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ from, to });
      if (statusFilter) params.set("status", statusFilter);
      try {
        const response = await fetch(`/api/admin/appointments/range?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as { appointments: AppointmentRow[] };
        setAppointments(body.appointments);
        const seen = new Map<string, WeekPatient>();
        for (const a of body.appointments) {
          if (!seen.has(a.patient.id)) {
            seen.set(a.patient.id, {
              id: a.patient.id,
              firstName: a.patient.firstName,
              lastName: a.patient.lastName,
            });
          }
        }
        onPatients?.([...seen.values()]);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // onPatients is a stable parent setter — intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, reloadToken]);

  const grouped = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const a of appointments) {
      const day = toClinicLocalDateString(new Date(a.startTime));
      if (dayFilter !== "all" && day !== dayFilter) continue;
      const list = map.get(day) ?? [];
      list.push(a);
      map.set(day, list);
    }
    return days
      .filter((d) => dayFilter === "all" || d === dayFilter)
      .map((d) => ({ day: d, rows: map.get(d) ?? [] }));
  }, [appointments, days, dayFilter]);

  const totalShown = grouped.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section
      aria-labelledby="week-strip-heading"
      className="dash-enter flex min-h-0 flex-col rounded-2xl border border-cyan-100 bg-white p-4 shadow-[0_4px_24px_-12px_rgba(8,145,178,0.35)] sm:p-5"
      style={{ animationDelay: "80ms" }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="week-strip-heading" className="text-base font-bold text-cyan-950">
            Semaine au fauteuil
          </h2>
          <p className="text-xs text-slate-500">
            {totalShown} rendez-vous · triés par heure ·{" "}
            <Link href="/admin/appointments" className="font-medium text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
              agenda complet →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="week-day-filter" className="block text-xs font-medium text-slate-600">
              Jour
            </label>
            <select
              id="week-day-filter"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className={inputClass}
            >
              <option value="all">Toute la semaine</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {shortDay(d)} {d.split("-").reverse().slice(0, 2).join("/")}
                  {d === today ? " · aujourd'hui" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="week-status-filter" className="block text-xs font-medium text-slate-600">
              État
            </label>
            <select
              id="week-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">Tous les états</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setReloadToken((t) => t + 1)}
            className="cursor-pointer rounded-lg border border-cyan-200 px-3 py-2 text-sm font-medium text-cyan-900 transition-colors duration-200 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Actualiser
          </button>
        </div>
      </div>

      <div aria-busy={loading} className="mt-4 min-h-0">
        {error ? (
          <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">
              Impossible de charger la semaine. Vérifiez la connexion.
            </p>
            <button
              type="button"
              onClick={() => setReloadToken((t) => t + 1)}
              className="cursor-pointer rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Réessayer
            </button>
          </div>
        ) : loading ? (
          <ul className="space-y-2" aria-label="Chargement de la semaine">
            {[0, 1, 2].map((i) => (
              <li key={i} role="status" aria-label="Chargement…" className="dash-skeleton h-16 rounded-xl" />
            ))}
          </ul>
        ) : totalShown === 0 ? (
          <p role="status" className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50/50 px-4 py-6 text-center text-sm text-slate-600">
            Aucun rendez-vous sur cette période.{" "}
            <Link href="/admin/appointments" className="font-semibold text-cyan-800 hover:underline">
              Créer un rendez-vous →
            </Link>
          </p>
        ) : (
          <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
            {grouped.map(({ day, rows }, gi) => (
              <div key={day} className="space-y-2">
                <div className="sticky top-0 z-[1] flex items-center gap-2 bg-white/95 py-1 backdrop-blur">
                  <span
                    aria-hidden="true"
                    className={`h-6 w-1 rounded-full ${day === today ? "bg-emerald-500" : "bg-cyan-300"}`}
                  />
                  <h3 className="text-sm font-bold text-cyan-950">
                    {dayLabel(day)}
                    {day === today && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                        Aujourd&apos;hui
                      </span>
                    )}
                  </h3>
                  <span className="text-xs text-slate-500">{rows.length}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="pl-3 text-xs text-slate-400">— Rien ce jour —</p>
                ) : (
                  <ul className="space-y-2 border-l-2 border-cyan-100 pl-3">
                    {rows.map((a, ri) => {
                      const start = new Date(a.startTime);
                      const end = new Date(a.endTime);
                      return (
                        <li
                          key={a.id}
                          className="dash-row space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-cyan-200 hover:shadow-md"
                          style={{ animationDelay: `${Math.min(gi * 60 + ri * 30, 400)}ms` }}
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-mono text-sm font-bold text-cyan-950">
                              {formatClinicLocalTime(start)}–{formatClinicLocalTime(end)}
                            </span>
                            <Link
                              href={`/admin/patients/${a.patient.id}`}
                              className="font-semibold text-slate-900 hover:text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                            >
                              {a.patient.lastName} {a.patient.firstName}
                            </Link>
                            <a
                              href={`tel:${a.patient.phone.replace(/[\s.]/g, "")}`}
                              className="cursor-pointer text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                              dir="auto"
                            >
                              {a.patient.phone}
                            </a>
                            <span className="text-slate-700">{localized(a.service.name, "fr")}</span>
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
                            onUpdated={() => setReloadToken((t) => t + 1)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
