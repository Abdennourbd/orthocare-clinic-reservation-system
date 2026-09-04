"use client";

import { useState, type FormEvent } from "react";

// Shared patient picker for the admin forms that act on an existing ACTIVE
// patient dossier (manual booking, single SMS, waitlist entry). Extracted
// from three copy-pasted implementations that had already drifted (name
// order differed between forms). One component, one search contract:
// SUBMIT-ONLY search against GET /api/admin/patients?q=… (same rationale as
// PatientList — one shared rate-limit pool), results filtered to active,
// non-anonymized dossiers. Unified display order: firstName lastName.

export interface PatientHit {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  anonymizedAt: string | null;
}

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonNeutral =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const errorTextClass = "text-sm text-red-700";

export default function PatientPicker({
  idPrefix,
  legend,
  selected,
  onSelect,
  fieldError,
}: {
  /** Prefix for the search input id (each form instance needs unique ids). */
  idPrefix: string;
  /** Fieldset legend, e.g. "Patient (dossier existant actif)". */
  legend: string;
  selected: PatientHit | null;
  onSelect: (p: PatientHit | null) => void;
  /** Validation error rendered under the picker (e.g. "Sélectionnez un patient."). */
  fieldError?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  async function searchPatients() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(false);
    try {
      const response = await fetch(`/api/admin/patients?q=${encodeURIComponent(q)}`);
      if (!response.ok) {
        setSearchError(true);
        return;
      }
      const body = (await response.json()) as { patients: PatientHit[] };
      setHits(body.patients.filter((p) => p.active && !p.anonymizedAt));
    } catch {
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchPatients();
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-slate-700">{legend}</span>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium text-slate-900">
            {selected.firstName} {selected.lastName}
          </span>
          <span className="text-slate-600" dir="auto">
            {selected.phone}
          </span>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setHits(null);
              setQuery("");
            }}
            className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Changer
          </button>
        </div>
      ) : (
        <form className="space-y-2" onSubmit={handleSubmit}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label
                htmlFor={`${idPrefix}-patient-q`}
                className="block text-xs font-medium text-slate-600"
              >
                Rechercher (nom ou téléphone)
              </label>
              <input
                id={`${idPrefix}-patient-q`}
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
            <button type="submit" disabled={searching || !query.trim()} className={buttonNeutral}>
              {searching ? "Recherche…" : "Rechercher"}
            </button>
          </div>
          {searchError && (
            <p role="alert" className={errorTextClass}>
              Recherche impossible. Réessayez.
            </p>
          )}
          {hits && hits.length === 0 && (
            <p className={errorTextClass} role="alert">
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
                      onSelect(p);
                      setHits(null);
                    }}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm
                      text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                  >
                    <span className="font-medium">
                      {p.firstName} {p.lastName}
                    </span>{" "}
                    <span className="text-slate-600" dir="auto">
                      {p.phone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {fieldError ? <p className={errorTextClass}>{fieldError}</p> : null}
    </div>
  );
}
