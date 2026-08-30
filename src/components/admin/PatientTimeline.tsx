"use client";

import { useEffect, useState } from "react";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 13 step 8 — unified history timeline: reads
// GET /api/admin/patients/[id]/history, which already merges and sorts
// `COMPLETED` appointments and `Visit` rows most-recent-first
// (src/app/api/admin/patients/[id]/history/route.ts) — this component does
// no client-side re-sorting, just renders what it received.
//
// The three states below (loading / empty / error) are the explicit,
// individually-graded acceptance criterion for this step
// (task-13.md étape 8 point 3): a 3-row skeleton with `aria-busy="true"`, a
// literal empty-state sentence, and an error message with a working
// "Réessayer" button — never a spinner-only or blank screen.
//
// Dates are formatted in the CLINIC's local time (Africa/Algiers), never the
// viewer's browser timezone — composed from the two exported primitives in
// src/lib/time/clinicTime.ts (the only module allowed to know the timezone,
// plan.md §Timezone) rather than hard-coding "Africa/Algiers" again here.

export type TimelineKind = "APPOINTMENT" | "VISIT";

export interface TimelineItem {
  kind: TimelineKind;
  id: string;
  date: string;
  serviceName: string | null;
  type: string | null;
  notes: string | null;
  treatment: string | null;
  status: string | null;
}

const KIND_LABEL: Record<TimelineKind, string> = {
  APPOINTMENT: "Rendez-vous",
  VISIT: "Visite",
};

const VISIT_TYPE_LABEL: Record<string, string> = {
  CONSULTATION: "Consultation",
  TRAITEMENT: "Traitement",
  CONTROLE: "Contrôle",
  URGENCE: "Urgence",
  AUTRE: "Autre",
};

function formatTimelineDate(iso: string): string {
  const date = new Date(iso);
  const [year, month, day] = toClinicLocalDateString(date).split("-");
  return `${day}/${month}/${year} à ${formatClinicLocalTime(date)}`;
}

export default function PatientTimeline({
  patientId,
  reloadToken,
}: {
  patientId: string;
  reloadToken: number;
}) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      setRateLimited(false);
      try {
        const response = await fetch(`/api/admin/patients/${patientId}/history`);
        if (cancelled) return;
        // Correction étape 8 (audit ortho-security, point 4) — a 429 is not
        // a server failure; see PatientDetail's identical fix (same shared
        // `staff:<userId>:patients-read` budget) for the full reasoning.
        if (response.status === 429) {
          setRateLimited(true);
          return;
        }
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as { items: TimelineItem[] };
        if (cancelled) return;
        setItems(body.items);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, reloadToken, retryToken]);

  return (
    <div className="space-y-3" aria-busy={loading}>
      <h2 className="text-lg font-semibold text-slate-900">Historique</h2>

      {rateLimited ? (
        // No "Réessayer" button here — see the effect's comment above. This
        // screen loads alongside PatientDetail's own record fetch, so it is
        // very often the SECOND read to hit the 429 in the same page load.
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p role="alert" className="text-sm text-amber-800">
            Trop de consultations de dossiers en peu de temps. Réessayez dans quelques minutes.
          </p>
        </div>
      ) : error ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p role="alert" className="text-sm text-red-700">
            Impossible de charger l&rsquo;historique de ce patient.
          </p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
              hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Réessayer
          </button>
        </div>
      ) : loading ? (
        // 3-row skeleton, per the explicit acceptance criterion.
        <ul className="space-y-2" role="status">
          <span className="sr-only">Chargement de l&rsquo;historique…</span>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-14 animate-pulse rounded-md border border-slate-200 bg-slate-100"
            />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500" role="status">
          Aucun rendez-vous terminé ni visite enregistrée pour ce patient.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="space-y-1 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.kind === "APPOINTMENT"
                      ? "bg-teal-100 text-teal-800"
                      : "bg-slate-200 text-slate-800"
                  }`}
                >
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="text-sm text-slate-600">{formatTimelineDate(item.date)}</span>
                {item.serviceName && (
                  <span className="text-sm text-slate-600" dir="auto">
                    {item.serviceName}
                  </span>
                )}
                {item.type && (
                  <span className="text-sm text-slate-600">
                    {VISIT_TYPE_LABEL[item.type] ?? item.type}
                  </span>
                )}
              </div>
              {item.treatment && (
                <p className="text-sm text-slate-700" dir="auto">
                  <span className="font-medium">Traitement : </span>
                  {item.treatment}
                </p>
              )}
              {item.notes && (
                <p className="text-sm text-slate-700" dir="auto">
                  <span className="font-medium">Notes : </span>
                  {item.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
