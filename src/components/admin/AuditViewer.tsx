"use client";

import { useEffect, useState, type FormEvent } from "react";

// Task 12 — audit log viewer (ADMIN only). Reads GET /api/admin/audit; the
// read itself is audited server-side. Filters: action, entityType, pagination.

interface AuditEntry {
  id: string;
  actorType: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail: unknown;
  ipAddress: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

export default function AuditViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionInput, setActionInput] = useState("");
  const [entityInput, setEntityInput] = useState("");
  const [filters, setFilters] = useState({ action: "", entityType: "" });
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (filters.action) params.set("action", filters.action);
      if (filters.entityType) params.set("entityType", filters.entityType);
      try {
        const response = await fetch(`/api/admin/audit?${params.toString()}`);
        if (cancelled) return;
        if (!response.ok) {
          setError("Impossible de charger le journal d'audit.");
          return;
        }
        const body = (await response.json()) as { entries: AuditEntry[]; total: number };
        if (cancelled) return;
        setEntries(body.entries);
        setTotal(body.total);
        setError(null);
      } catch {
        if (!cancelled) setError("Impossible de charger le journal d'audit.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, filters, reloadToken]);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPage(1);
    setFilters({ action: actionInput.trim(), entityType: entityInput.trim() });
    setReloadToken((token) => token + 1);
  }

  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const inputClass =
    "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Journal d&apos;audit</h1>
        <p className="text-sm text-slate-500">
          Historique complet et inaltérable des actions du personnel, du système et des patients.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleFilterSubmit}>
        <div className="space-y-1">
          <label htmlFor="audit-action" className="block text-xs font-medium text-slate-600">
            Action
          </label>
          <input
            id="audit-action"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="ex. LOGIN_SUCCESS"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-entity" className="block text-xs font-medium text-slate-600">
            Type d&apos;entité
          </label>
          <input
            id="audit-entity"
            value={entityInput}
            onChange={(e) => setEntityInput(e.target.value)}
            placeholder="ex. Appointment"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
            hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Filtrer
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500" role="status">
          Chargement…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500" role="status">
          Aucune entrée d&apos;audit pour ces critères.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Entrées du journal d&apos;audit</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Date</th>
                <th scope="col" className="px-4 py-2">Acteur</th>
                <th scope="col" className="px-4 py-2">Action</th>
                <th scope="col" className="px-4 py-2">Entité</th>
                <th scope="col" className="px-4 py-2">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {new Date(entry.createdAt).toLocaleString("fr-DZ")}
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    {entry.userName ?? entry.actorType}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-900">{entry.action}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {entry.entityType}#{entry.entityId.slice(0, 8)}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-slate-500">
                    {JSON.stringify(entry.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center gap-3" aria-label="Pagination">
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setPage((p) => Math.max(p - 1, 1));
          }}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700
            hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-50"
        >
          Précédent
        </button>
        <span className="text-sm text-slate-600">
          Page {page} / {pageCount} — {total} entrées
        </span>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setPage((p) => Math.min(p + 1, pageCount));
          }}
          disabled={page >= pageCount}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700
            hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suivant
        </button>
      </nav>
    </div>
  );
}
