"use client";

import { useState } from "react";

// Task 13 step 8 — the erasure-request action. ADMIN-only in the UI (hidden
// by PatientDetail for a RECEPTIONIST — see that component's comment on why
// hiding a button is never the access control: POST
// /api/admin/patients/[id]/anonymize independently requires ADMIN and
// re-checks role itself, task-13.md §Points de vigilance non négociables).
//
// Irreversible, and there is no undo anywhere in this task
// (src/lib/privacy/anonymize.ts header comment). Two layers of friction
// against an accidental trigger, per the explicit acceptance criterion
// ("ne doit pas pouvoir partir sur un double-clic"):
//   1. the confirm button stays disabled until the staff member types the
//      patient's own last name (case/diacritic-insensitive is NOT applied
//      here on purpose — this is a deliberate typing gesture, not a search,
//      so it should match what is actually printed on screen);
//   2. `pending` disables the button again for the duration of the request,
//      so a double-click cannot fire two requests even after the name gate
//      is satisfied.
// No modal, no `window.confirm` — everything here is inline in the
// "Demande d'effacement" zone, exactly like every other confirmation on this
// screen (task-13.md §Points de vigilance non négociables).

export interface AnonymizeResult {
  id: string;
  anonymizedAt: string;
  appointmentsKept: number;
  visitsKept: number;
}

export default function AnonymizePatientAction({
  patientId,
  lastName,
  onAnonymized,
}: {
  patientId: string;
  lastName: string;
  onAnonymized: (result: AnonymizeResult) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = confirmText.trim() === lastName.trim() && confirmText.trim().length > 0;

  async function handleConfirm() {
    if (!canConfirm || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/patients/${patientId}/anonymize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 429) {
          setError("Trop de requêtes. Réessayez plus tard.");
        } else {
          setError(
            (body?.error?.message as string | undefined) ??
              "Impossible d'anonymiser ce dossier. Réessayez.",
          );
        }
        return;
      }
      onAnonymized(body as AnonymizeResult);
    } catch {
      setError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-red-900">Demande d&rsquo;effacement</h3>
        <p className="text-sm text-red-800">
          Cette action supprime définitivement le nom, le téléphone, l&rsquo;e-mail, la date de
          naissance et les notes de ce dossier, ainsi que les identifiants du patient dans les
          SMS déjà envoyés. Elle est <strong>irréversible</strong>. L&rsquo;historique des
          rendez-vous et des visites est conservé (sans notes), pour que les statistiques de la
          clinique restent exactes.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="anonymize-confirm" className="block text-sm font-medium text-red-900">
          Pour confirmer, saisissez le nom de famille du patient (« {lastName} »)
        </label>
        <input
          id="anonymize-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          dir="auto"
          autoComplete="off"
          className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-slate-900
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        />
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canConfirm || pending}
        className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white
          hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-teal-600 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Anonymisation…" : "Anonymiser définitivement ce dossier"}
      </button>
    </div>
  );
}
