"use client";

import { useState } from "react";
import { localized } from "@/lib/i18n/localized";
import { toClinicLocalDateString, formatClinicLocalTime } from "@/lib/time/clinicTime";

// Task 17.3 — waitlist rows (pure presentation). The container
// (WaitlistDashboard) owns the GET /api/admin/waitlist fetch; this component
// only renders rows and owns the DELETE interaction, following the inline
// two-step confirm pattern of PatientDocuments (no modal, no window.confirm).
//
// Phone numbers render in full: this is a staff-only page, same ruling as
// the appointment call queue. Nothing is logged to the console.

export interface WaitlistPatientRef {
  id: string;
  firstName: string;
  lastName: string;
  /** GET /api/admin/waitlist returns `phoneE164`; `phone` is the legacy alias. */
  phoneE164?: string;
  phone?: string;
}

export interface WaitlistServiceRef {
  id: string;
  /** Per-locale JSON `{fr, ar, en}` as returned by the API — render via
   * `localized(service.name, "fr")` (admin dashboard is FR only). */
  name: Record<string, string | null | undefined> | string;
  slug: string;
}

export interface WaitlistEntry {
  id: string;
  /** ISO instants (each clinic-local date's UTC midnight). */
  preferredDates: string[];
  source: string;
  active: boolean;
  notifiedAt: string | null;
  createdAt: string;
  patient: WaitlistPatientRef;
  service: WaitlistServiceRef;
}

export const WAITLIST_SOURCE_LABELS: Record<string, string> = {
  PATIENT: "En ligne",
  STAFF: "Guichet",
};

function serviceName(service: WaitlistServiceRef): string {
  if (typeof service.name === "string") return service.name;
  return localized(service.name, "fr");
}

function patientPhone(patient: WaitlistPatientRef): string {
  return patient.phoneE164 ?? patient.phone ?? "";
}

function formatWatchDate(iso: string): string {
  return toClinicLocalDateString(new Date(iso)).split("-").reverse().join("/");
}

function formatNotifiedAt(iso: string): string {
  const date = new Date(iso);
  const day = toClinicLocalDateString(date).split("-").reverse().join("/");
  return `Notifié le ${day} à ${formatClinicLocalTime(date)}`;
}

export default function WaitlistList({
  entries,
  onDeleted,
}: {
  entries: WaitlistEntry[];
  onDeleted?: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteConfirm() {
    if (!confirmId || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/waitlist/${confirmId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        const removedId = confirmId;
        setConfirmId(null);
        // BUG-1: success notice is owned by WaitlistDashboard (survives the
        // reload skeleton); this list only notifies the parent.
        onDeleted?.(removedId);
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setDeleteError(body?.error?.message ?? "Impossible de supprimer cette entrée.");
    } catch {
      setDeleteError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setDeletePending(false);
    }
  }

  if (entries.length === 0) {
    return (
      <p role="status" className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        Aucune entrée en liste d&rsquo;attente.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Entrées en liste d&rsquo;attente</caption>
          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Patient</th>
              <th scope="col" className="px-4 py-2">Téléphone</th>
              <th scope="col" className="px-4 py-2">Service</th>
              <th scope="col" className="px-4 py-2">Dates surveillées</th>
              <th scope="col" className="px-4 py-2">Source</th>
              <th scope="col" className="px-4 py-2">Suivi</th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const patientLabel = `${entry.patient.lastName} ${entry.patient.firstName}`;
              return (
                <tr key={entry.id}>
                  <td className="px-4 py-2 font-medium text-slate-900" dir="auto">
                    {patientLabel}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600" dir="auto">
                    {patientPhone(entry.patient)}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{serviceName(entry.service)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {entry.preferredDates.map(formatWatchDate).join(" · ")}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {WAITLIST_SOURCE_LABELS[entry.source] ?? entry.source}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                    {entry.notifiedAt ? formatNotifiedAt(entry.notifiedAt) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {confirmId !== entry.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmId(entry.id);
                          setDeleteError(null);
                        }}
                        aria-label={`Supprimer l'entrée de ${patientLabel}`}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
                          hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      >
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmId && (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p role="alert" className="text-sm text-red-800">
            Supprimer cette entrée de la liste d&rsquo;attente ? Cette action est irréversible.
          </p>
          {deleteError && (
            <p role="alert" className="text-sm text-red-700">
              {deleteError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              disabled={deletePending}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white
                hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletePending ? "Suppression…" : "Confirmer la suppression"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmId(null);
                setDeleteError(null);
              }}
              disabled={deletePending}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800
                hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
