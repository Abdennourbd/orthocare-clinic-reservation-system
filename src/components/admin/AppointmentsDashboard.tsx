"use client";

import { useCallback, useState } from "react";
import AppointmentDayView from "./AppointmentDayView";
import AppointmentCallQueue from "./AppointmentCallQueue";
import AppointmentSearch from "./AppointmentSearch";
import ManualBookingForm from "./ManualBookingForm";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import type { AppointmentRow } from "./appointmentTypes";

// Task 14 step 5 — the appointments dashboard shell: header, the prominent
// "Nouveau rendez-vous" action (inline form, never a modal), and the three
// sections as accessible tabs-lite (a nav with aria-current, per the brief).
// All three sections stay mounted and are toggled with `hidden` so the
// receptionist's picked day / submitted search survive tab switches.
//
// Booking success and every child action funnel into `bumpReload()`, which
// re-runs the day view + call queue + current search fetches through their
// reloadToken props.

const TABS = [
  { key: "agenda", label: "Agenda" },
  { key: "queue", label: "File d'attente" },
  { key: "search", label: "Recherche" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function AppointmentsDashboard() {
  const [tab, setTab] = useState<TabKey>("agenda");
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const bumpReload = useCallback(() => setReloadToken((t) => t + 1), []);

  function handleBooked(appointment: AppointmentRow) {
    setShowBookingForm(false);
    const start = new Date(appointment.startTime);
    setSuccessMessage(
      `Rendez-vous créé le ${toClinicLocalDateString(start).split("-").reverse().join("/")} à ${formatClinicLocalTime(start)} (heure du cabinet).`,
    );
    bumpReload();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Rendez-vous</h1>
          <p className="text-sm text-slate-500">
            Agenda du jour, file d&rsquo;attente des appels et recherche.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowBookingForm((v) => !v);
            setSuccessMessage(null);
          }}
          aria-expanded={showBookingForm}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600
            focus-visible:ring-offset-2"
        >
          {showBookingForm ? "Fermer le formulaire" : "Nouveau rendez-vous"}
        </button>
      </header>

      {successMessage && (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm
            text-emerald-800"
        >
          {successMessage}
        </p>
      )}

      {showBookingForm && (
        <ManualBookingForm onSuccess={handleBooked} onCancel={() => setShowBookingForm(false)} />
      )}

      <nav aria-label="Sections rendez-vous" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={
              "rounded-t-md px-4 py-2 text-sm font-medium focus-visible:outline-none " +
              "focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
              (tab === t.key
                ? "border-x border-t border-slate-200 bg-white text-teal-800"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-800")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "agenda"}>
        <AppointmentDayView reloadToken={reloadToken} />
      </div>
      <div hidden={tab !== "queue"}>
        <AppointmentCallQueue reloadToken={reloadToken} />
      </div>
      <div hidden={tab !== "search"}>
        <AppointmentSearch reloadToken={reloadToken} />
      </div>
    </div>
  );
}
