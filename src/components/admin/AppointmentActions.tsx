"use client";

import { useState } from "react";
import {
  formatClinicLocalTime,
  toClinicLocalDateString,
  clinicLocalToUTC,
} from "@/lib/time/clinicTime";

// Task 14 step 5 — the shared staff action set for one appointment:
// PATCH /api/admin/appointments/[id] (CONFIRM/CANCEL/COMPLETE/NO_SHOW) and
// POST …/[id]/reschedule (Reporter). Button visibility mirrors the API's
// transition map (src/lib/booking/adminTransitions.ts) — CONFIRmer only on
// PENDING, Terminé/Absent only on CONFIRMED, Annuler/Reporter on both active
// statuses — but the API remains the sole authority; hiding a button is a
// UX choice, not an access control.
//
// Destructive actions are confirmed inline (never window.confirm, never a
// modal — same discipline as the patient screens), and errors land as an
// inline role="alert" paragraph next to the buttons.

const buttonBase =
  "rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-60";
const buttonPrimary = `${buttonBase} bg-teal-700 text-white hover:bg-teal-800`;
const buttonNeutral = `${buttonBase} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;
const buttonDanger = `${buttonBase} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

function friendlyError(status: number, body: { error?: { message?: string } } | null): string {
  if (status === 409) return body?.error?.message ?? "Action impossible : le rendez-vous a changé entre-temps. Actualisez la liste.";
  if (status === 429) return "Trop de requêtes. Réessayez plus tard.";
  return body?.error?.message ?? "Une erreur est survenue. Réessayez.";
}

export default function AppointmentActions({
  appointmentId,
  status,
  startTime,
  onUpdated,
}: {
  appointmentId: string;
  status: string;
  startTime: string;
  /** Called after ANY successful change so the parent reloads its list. */
  onUpdated: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState<string | null>(null);

  // Reschedule defaults: the appointment's CURRENT slot, in clinic-local terms.
  const startDate = new Date(startTime);
  const [rescheduleDate, setRescheduleDate] = useState(() => toClinicLocalDateString(startDate));
  const [rescheduleTime, setRescheduleTime] = useState(() => formatClinicLocalTime(startDate));

  const isActive = status === "PENDING" || status === "CONFIRMED";

  async function runStatusAction(action: "CONFIRM" | "CANCEL" | "COMPLETE" | "NO_SHOW") {
    setPending(true);
    setError(null);
    setRescheduleMessage(null);
    try {
      const response = await fetch(`/api/admin/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(friendlyError(response.status, body));
        return;
      }
      setConfirmCancel(false);
      onUpdated();
    } catch {
      setError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  async function submitReschedule() {
    const utc = clinicLocalToUTC(rescheduleDate, rescheduleTime);
    if (!utc) {
      setError("Date ou heure de report invalide.");
      return;
    }
    setPending(true);
    setError(null);
    setRescheduleMessage(null);
    try {
      const response = await fetch(`/api/admin/appointments/${appointmentId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: utc.toISOString() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(friendlyError(response.status, body));
        return;
      }
      const newStart = new Date(body?.newAppointment?.startTime ?? utc.toISOString());
      setRescheduleOpen(false);
      setRescheduleMessage(
        `Reporté au ${toClinicLocalDateString(newStart).split("-").reverse().join("/")} à ${formatClinicLocalTime(newStart)}.`,
      );
      onUpdated();
    } catch {
      setError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  if (!isActive) {
    return rescheduleMessage ? (
      <p role="status" className="text-xs text-slate-600">
        {rescheduleMessage}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "PENDING" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void runStatusAction("CONFIRM")}
            className={buttonPrimary}
          >
            Confirmer
          </button>
        )}
        {status === "CONFIRMED" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => void runStatusAction("COMPLETE")}
              className={buttonPrimary}
            >
              Terminé
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void runStatusAction("NO_SHOW")}
              className={buttonNeutral}
            >
              Absent
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setRescheduleOpen((v) => !v);
            setError(null);
          }}
          aria-expanded={rescheduleOpen}
          className={buttonNeutral}
        >
          Reporter
        </button>
        {confirmCancel ? (
          <span className="flex items-center gap-2 text-xs text-slate-600">
            Confirmer l&rsquo;annulation ?
            <button
              type="button"
              disabled={pending}
              onClick={() => void runStatusAction("CANCEL")}
              className={buttonDanger}
            >
              Oui, annuler
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmCancel(false)}
              className={buttonNeutral}
            >
              Non
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmCancel(true)}
            className={buttonDanger}
          >
            Annuler
          </button>
        )}
      </div>

      {rescheduleOpen && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitReschedule();
          }}
        >
          <div className="space-y-1">
            <label htmlFor={`reschedule-date-${appointmentId}`} className="block text-xs font-medium text-slate-600">
              Nouvelle date
            </label>
            <input
              id={`reschedule-date-${appointmentId}`}
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`reschedule-time-${appointmentId}`} className="block text-xs font-medium text-slate-600">
              Nouvelle heure (heure du cabinet)
            </label>
            <input
              id={`reschedule-time-${appointmentId}`}
              type="time"
              value={rescheduleTime}
              onChange={(e) => setRescheduleTime(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className={`${buttonBase} bg-teal-700 text-white hover:bg-teal-800`}
          >
            {pending ? "Envoi…" : "Valider le report"}
          </button>
        </form>
      )}

      {rescheduleMessage && (
        <p role="status" className="text-xs text-emerald-700">
          {rescheduleMessage}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
