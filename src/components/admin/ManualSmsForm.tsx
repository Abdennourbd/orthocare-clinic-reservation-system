"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SmsBanner } from "./SmsCenter";

// Task 16 — manual single SMS (POST /api/admin/sms/single): pick an EXISTING
// active patient via a debounced search against GET /api/admin/patients (the
// brief mandates ~300ms debounce for this picker, unlike the submit-only
// searches elsewhere), a free-text message bounded at 480 characters (the
// same bound as singleSmsSchema — the server re-validates), and send.
//
// Success / non-SENT outcomes are reported to the shell banner through
// `onNotify` (the message body itself is never echoed — the response only
// carries { sent, messageId, status }). API failures stay inline from
// `error.message`. The patient stays selected after a send so a follow-up
// message to the same patient needs no second search.

interface PatientHit {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  anonymizedAt: string | null;
}

// Matches the rate-limit-friendly debounce the brief asks for; short enough
// that the picker feels live, long enough to collapse typing bursts (each
// fired search is an audited, rate-limited read of the patient directory).
const SEARCH_DEBOUNCE_MS = 300;
const SMS_MAX_LENGTH = 480;

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const labelClass = "block text-sm font-medium text-slate-700";
const errorTextClass = "text-xs text-red-700";
const buttonPrimary =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export default function ManualSmsForm({
  onNotify,
}: {
  onNotify: (banner: SmsBanner) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null);
  const [body, setBody] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Debounced patient search. `cancelled` guards every state write against
  // out-of-order responses (a slower earlier query must never overwrite a
  // later one's results), same convention as AuditViewer's effect. The
  // empty-query reset lives in the change handler, not here — an effect body
  // must not setState synchronously.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        setSearching(true);
        setSearchError(false);
        try {
          const response = await fetch(`/api/admin/patients?q=${encodeURIComponent(q)}`);
          if (cancelled) return;
          if (!response.ok) {
            setSearchError(true);
            return;
          }
          const data = (await response.json()) as { patients: PatientHit[] };
          if (cancelled) return;
          // The route already defaults to active patients; the filter also
          // drops anonymized rows, mirroring ManualBookingForm's picker.
          setHits(data.patients.filter((p) => p.active && !p.anonymizedAt));
        } catch {
          if (!cancelled) setSearchError(true);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function submitSms() {
    if (!selectedPatient) return;
    const patient = selectedPatient;
    setPending(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/sms/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id, body: body.trim() }),
      });
      const data = (await response.json().catch(() => null)) as {
        sent?: boolean;
        status?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setFormError(data?.error?.message ?? "Une erreur est survenue. Réessayez.");
        return;
      }
      setBody("");
      if (data?.sent) {
        onNotify({
          kind: "success",
          message: `SMS envoyé à ${patient.firstName} ${patient.lastName}.`,
        });
      } else if (data?.status) {
        // Row recorded but not delivered (provider failure): make the status
        // visible instead of pretending the send worked.
        onNotify({
          kind: "error",
          message: `Échec d'envoi du SMS à ${patient.firstName} ${patient.lastName} (statut : ${data.status}).`,
        });
      } else {
        // `sent: false` with no status is the dispatcher's opt-out gate.
        onNotify({
          kind: "error",
          message: `Échec d'envoi : ${patient.firstName} ${patient.lastName} est opposé aux messages.`,
        });
      }
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // JS guard first: the textarea also carries `required`, but jsdom-level
    // clicks bypass constraint validation and the API would 400 anyway —
    // never a network call for a request we already know is invalid.
    if (!selectedPatient) {
      setValidationError("Sélectionnez un patient.");
      return;
    }
    if (!body.trim()) {
      setValidationError("Le message est requis.");
      return;
    }
    setValidationError(null);
    void submitSms();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Envoi manuel</h2>

      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <div className="space-y-2">
            <span className={labelClass}>Patient</span>
            {selectedPatient ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">
                  {selectedPatient.firstName} {selectedPatient.lastName}
                </span>
                <span className="text-slate-600" dir="auto">
                  {selectedPatient.phone}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPatient(null);
                    setQuery("");
                    setHits(null);
                  }}
                  className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700
                    hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                >
                  Retirer
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label htmlFor="sms-patient-q" className="block text-xs font-medium text-slate-600">
                    Rechercher un patient (nom ou téléphone)
                  </label>
                  <input
                    id="sms-patient-q"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHits(null);
                      setSearchError(false);
                    }}
                    dir="auto"
                    autoComplete="off"
                    className={inputClass}
                  />
                </div>
                {searching && (
                  <p className={errorTextClass} role="status">
                    Recherche…
                  </p>
                )}
                {searchError && (
                  <p role="alert" className={errorTextClass}>
                    Recherche impossible. Réessayez.
                  </p>
                )}
                {hits && hits.length === 0 && (
                  <p className={errorTextClass} role="status">
                    Aucun patient actif trouvé. Créez d&rsquo;abord le dossier dans « Patients ».
                  </p>
                )}
                {hits && hits.length > 0 && (
                  <ul className="space-y-1">
                    {hits.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatient(p);
                            setHits(null);
                          }}
                          className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm
                            text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                        >
                          {p.firstName} {p.lastName}{" "}
                          <span className="text-slate-600" dir="auto">
                            — {p.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {validationError === "Sélectionnez un patient." && (
              <p className={errorTextClass}>{validationError}</p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <label htmlFor="sms-body" className={labelClass}>
                Message
              </label>
              <span className="text-xs text-slate-500" aria-hidden="true">
                {body.length} / {SMS_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id="sms-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={SMS_MAX_LENGTH}
              required
              dir="auto"
              className={inputClass}
              aria-describedby="sms-body-counter"
            />
            <p id="sms-body-counter" className="sr-only">
              {body.length} caractères sur {SMS_MAX_LENGTH} maximum.
            </p>
            {validationError === "Le message est requis." && (
              <p className={errorTextClass}>{validationError}</p>
            )}
          </div>
        </fieldset>

        <div className="pt-2">
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}
