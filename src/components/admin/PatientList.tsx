"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import PatientForm, { type PatientFormSuccess } from "./PatientForm";

// Task 13 step 7 — patient directory: explicit-submit search, active/inactive
// filter, pagination, and the inline (never-modal) create form. State
// structure (loading / empty / error, `aria-busy`, "Réessayer") is copied
// from src/components/admin/AuditViewer.tsx (task-13.md étape 7 spec: "calque
// la structure d'états sur AuditViewer").
//
// Search is submit-only, never per-keystroke: GET /api/admin/patients is
// rate-limited to 60 req/5min per staff session and every call is audited
// (task-13.md §Contraintes issues des audits de sécurité) — typing a name at
// keystroke speed would burn the budget and flood the audit log with a
// partial name on every character.
//
// The `q` value never appears in a redirect URL, a `title`, nor an
// `aria-label` outside this same-origin fetch call (task-13.md §Vigilance
// sécurité — the browser's own address bar for this page is never mutated
// with the search term; it stays local component state, sent only as a
// `fetch` query string to `/api/admin/*`).

interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  anonymizedAt: string | null;
  createdAt: string;
}

type ActiveFilter = "true" | "false" | "all";

const PAGE_SIZE = 50;

export default function PatientList() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState("");
  const [activeInput, setActiveInput] = useState<ActiveFilter>("true");
  const [filters, setFilters] = useState<{ q: string; active: ActiveFilter }>({
    q: "",
    active: "true",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ page: String(page) });
      // A blank search/limit field must never become `?q=` or `?limit=` — the
      // API's Zod schema (patientListQuerySchema) rejects an empty string
      // with 400 (task-13.md §Contraintes issues des audits de sécurité).
      if (filters.q) params.set("q", filters.q);
      if (filters.active !== "true") params.set("active", filters.active);
      try {
        const response = await fetch(`/api/admin/patients?${params.toString()}`);
        if (cancelled) return;
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as {
          patients: PatientRow[];
          total: number;
        };
        if (cancelled) return;
        setPatients(body.patients);
        setTotal(body.total);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, filters, reloadToken]);

  useEffect(() => {
    if (successMessage) successRef.current?.focus();
  }, [successMessage]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setFilters({ q: qInput.trim(), active: activeInput });
  }

  function handleCreated(patient: PatientFormSuccess) {
    setShowForm(false);
    setSuccessMessage(`Patient « ${patient.lastName} ${patient.firstName} » créé.`);
    setPage(1);
    reload();
  }

  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const inputClass =
    "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
  const newPatientButtonClass =
    "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
    "disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Patients</h1>
          <p className="text-sm text-slate-500">Recherche, création et suivi des dossiers patients.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
          className={newPatientButtonClass}
        >
          {showForm ? "Annuler" : "Nouveau patient"}
        </button>
      </header>

      {successMessage && (
        <p
          ref={successRef}
          role="status"
          tabIndex={-1}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm
            text-emerald-800 focus:outline-none"
        >
          {successMessage}
        </p>
      )}

      {showForm && (
        <PatientForm onSuccess={handleCreated} onCancel={() => setShowForm(false)} />
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleSearchSubmit}>
        <div className="space-y-1">
          <label htmlFor="patient-search-q" className="block text-xs font-medium text-slate-600">
            Rechercher (nom ou téléphone)
          </label>
          <input
            id="patient-search-q"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            dir="auto"
            autoComplete="off"
            placeholder="ex. Benali ou 0550…"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="patient-search-active" className="block text-xs font-medium text-slate-600">
            Statut
          </label>
          <select
            id="patient-search-active"
            value={activeInput}
            onChange={(e) => setActiveInput(e.target.value as ActiveFilter)}
            className={inputClass}
          >
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
            <option value="all">Tous</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
            hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Rechercher
        </button>
      </form>

      <div aria-busy={loading}>
        {error ? (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">
              Impossible de charger la liste des patients.
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
        ) : patients.length === 0 ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-500" role="status">
              Aucun patient trouvé.
            </p>
            {!showForm && (
              <button type="button" onClick={() => setShowForm(true)} className={newPatientButtonClass}>
                Nouveau patient
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Liste des patients</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">Nom</th>
                  <th scope="col" className="px-4 py-2">Prénom</th>
                  <th scope="col" className="px-4 py-2">Téléphone</th>
                  <th scope="col" className="px-4 py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td className="px-4 py-2 font-medium text-slate-900" dir="auto">
                      {/* Correction étape 8 (audit ortho-reviewer, point 2) —
                          `next/link`, not a raw `<a>`: `no-html-link-for-pages`
                          does not flag a template-literal `href`, so this had
                          been slipping past `npm run lint` for an internal
                          route. */}
                      <Link
                        href={`/admin/patients/${patient.id}`}
                        className="rounded-sm focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      >
                        {patient.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700" dir="auto">
                      {patient.firstName}
                    </td>
                    <td className="px-4 py-2 text-slate-600" dir="auto">
                      {patient.phone}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {patient.anonymizedAt ? "Anonymisé" : patient.active ? "Actif" : "Inactif"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!error && !loading && patients.length > 0 && (
        <nav className="flex items-center gap-3" aria-label="Pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-50"
          >
            Précédent
          </button>
          <span className="text-sm text-slate-600">
            Page {page} / {pageCount} — {total} patient{total > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
            disabled={page >= pageCount}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-50"
          >
            Suivant
          </button>
        </nav>
      )}
    </div>
  );
}
