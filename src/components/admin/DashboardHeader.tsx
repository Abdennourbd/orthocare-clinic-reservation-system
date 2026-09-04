"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CLINIC_TIMEZONE } from "@/lib/time/clinicTime";

// Briefing du matin — hero « pulse » dentist-first.
// Server passes greeting + nowISO (no browser-tz maths here for the initial
// paint); the clock ticks client-side from that instant, always formatted in
// Africa/Algiers. Pure CSS entrance (dashboard.css .dash-enter), SVG icons
// only (no emojis), FR-only strings.

function formatClock(from: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLINIC_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(from);
}

export default function DashboardHeader({
  greeting,
  nowISO,
  todayCount,
  pendingCount,
  tomorrowCount,
  utilizationRate,
  isFridayClosed,
  rangeLabel,
}: {
  greeting: string;
  nowISO: string;
  todayCount: number;
  pendingCount: number;
  tomorrowCount: number;
  utilizationRate: number | null;
  isFridayClosed: boolean;
  rangeLabel: string;
}) {
  const [now, setNow] = useState(() => new Date(nowISO));

  useEffect(() => {
    setNow(new Date(nowISO));
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [nowISO]);

  const pct =
    utilizationRate !== null && Number.isFinite(utilizationRate)
      ? Math.max(0, Math.min(100, Math.round(utilizationRate * 100)))
      : null;
  const ringR = 26;
  const ringC = 2 * Math.PI * ringR;

  return (
    <section
      aria-labelledby="briefing-heading"
      className="dash-enter overflow-hidden rounded-2xl border border-cyan-100 bg-white shadow-[0_4px_24px_-8px_rgba(8,145,178,0.25)]"
      style={{ animationDelay: "0ms" }}
    >
      {/* Top accent: calm cyan → health green, flat (no neon, no purple). */}
      <div aria-hidden="true" className="h-1.5 w-full bg-gradient-to-r from-cyan-600 via-cyan-500 to-emerald-600" />
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">
            Briefing du matin · {rangeLabel}
          </p>
          <h1 id="briefing-heading" className="text-2xl font-bold tracking-tight text-cyan-950 sm:text-3xl">
            {greeting}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-cyan-700">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M10 5.5V10l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>
              Heure du cabinet{" "}
              <span role="timer" aria-label="Heure du cabinet" className="font-mono font-semibold text-cyan-950">
                {formatClock(now)}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              <span className="font-semibold text-cyan-950">{todayCount}</span> aujourd&apos;hui
              <span aria-hidden="true" className="text-slate-300"> · </span>
              <span className="font-semibold text-amber-800">{pendingCount}</span> à rappeler
              <span aria-hidden="true" className="text-slate-300"> · </span>
              <span className="font-semibold text-cyan-950">{tomorrowCount}</span> demain
            </span>
          </p>
          {isFridayClosed && (
            <p role="status" className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                <path d="M8 1.5 15 14H1L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
              </svg>
              Cabinet fermé le vendredi — semaine précédente complétée affichée.
            </p>
          )}
          <nav aria-label="Accès rapides" className="flex flex-wrap gap-2 pt-2">
            <Link
              href="/admin/appointments"
              className="cursor-pointer rounded-lg bg-cyan-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:bg-cyan-800 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Ouvrir l&apos;agenda
            </Link>
            <Link
              href="/admin/appointments?tab=queue"
              className="cursor-pointer rounded-lg border-2 border-cyan-700 bg-white px-3.5 py-[6px] text-sm font-semibold text-cyan-800 transition-all duration-200 hover:-translate-y-px hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              File d&apos;appels ({pendingCount})
            </Link>
            <Link
              href="/admin/sms"
              className="cursor-pointer rounded-lg px-3.5 py-2 text-sm font-semibold text-cyan-800 transition-colors duration-200 hover:bg-cyan-50 hover:text-cyan-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              SMS →
            </Link>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-cyan-50/70 p-4 ring-1 ring-cyan-100">
          <div className="relative h-[72px] w-[72px]" role="img" aria-label={pct === null ? "Taux d'occupation non disponible" : `Taux d'occupation ${pct} pour cent`}>
            <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
              <circle cx="36" cy="36" r={ringR} fill="none" stroke="#A5F3FC" strokeWidth="8" />
              {pct !== null && (
                <circle
                  cx="36"
                  cy="36"
                  r={ringR}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringC - (ringC * pct) / 100}
                />
              )}
            </svg>
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-sm font-bold text-cyan-950">
              {pct === null ? "—" : `${pct}%`}
            </span>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">Occupation semaine</p>
            <p className="text-sm text-slate-600">
              {pct === null ? "Hors heures ouvrées" : "minutes réservées / ouvertes"}
            </p>
            <p className="text-xs text-slate-500">Sam → Jeu · ven fermé</p>
          </div>
        </div>
      </div>
    </section>
  );
}
