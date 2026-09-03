"use client";

import { useCallback, useEffect, useState } from "react";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import WaitlistForm, { type WaitlistServiceOption } from "./WaitlistForm";
import WaitlistList, { type WaitlistEntry } from "./WaitlistList";

// Task 17.3 — waitlist dashboard container. Owns BOTH reads (the
// GET /api/admin/waitlist list + the /api/services options for the filter
// and the form) and delegates all rendering to the presentational children:
// WaitlistForm (create) and WaitlistList (rows + delete). State structure
// (loading skeleton with `aria-busy` / empty / error + "Réessayer") mirrors
// PatientList and AppointmentDayView.

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

function serviceOptionLabel(name: unknown): string {
  if (typeof name === "string") return name;
  return localized(name as LocalizedField, "fr");
}

export default function WaitlistDashboard() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [services, setServices] = useState<WaitlistServiceOption[]>([]);
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"true" | "false" | "all">("true");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // BUG-1: delete-success notice lives here (not in WaitlistList) so the
  // reload skeleton (which unmounts the list) cannot wipe it — same ruling
  // as the create banner in WaitlistForm, which survives because the form
  // never unmounts.
  const [notice, setNotice] = useState<string | null>(null);

  // Service options load once: the same list feeds the filter dropdown and
  // the create form (passed as props, so the form never fetches twice).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/services?locale=fr");
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as {
          services: Array<{ id: string; name: unknown }>;
        };
        if (cancelled) return;
        setServices(body.services.map((s) => ({ id: s.id, name: serviceOptionLabel(s.name) })));
      } catch {
        if (!cancelled) setServices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ active: statusFilter });
      if (serviceFilter) params.set("serviceId", serviceFilter);
      try {
        const response = await fetch(`/api/admin/waitlist?${params.toString()}`);
        if (cancelled) return;
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as {
          entries: WaitlistEntry[];
          nextCursor?: string | null;
        };
        if (cancelled) return;
        setEntries(body.entries);
        setNextCursor(body.nextCursor ?? null);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceFilter, statusFilter, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ active: statusFilter });
      if (serviceFilter) params.set("serviceId", serviceFilter);
      params.set("cursor", nextCursor);
      const response = await fetch(`/api/admin/waitlist?${params.toString()}`);
      if (!response.ok) return;
      const body = (await response.json()) as {
        entries: WaitlistEntry[];
        nextCursor?: string | null;
      };
      setEntries((prev) => [...prev, ...body.entries]);
      setNextCursor(body.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, serviceFilter, statusFilter]);
  const handleDeleted = useCallback(() => {
    setNotice("Entrée supprimée de la liste d'attente.");
    reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <WaitlistForm services={services} onCreated={reload} />

      <section aria-labelledby="waitlist-filter-heading" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="waitlist-service-filter" className="block text-xs font-medium text-slate-600">
              Filtrer par service
            </label>
            <select
              id="waitlist-service-filter"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">Tous les services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <span id="waitlist-status-label" className="block text-xs font-medium text-slate-600">
              Statut
            </span>
            <div role="group" aria-labelledby="waitlist-status-label" className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
              {(
                [
                  ["true", "Actives"],
                  ["false", "Notifiées"],
                  ["all", "Toutes"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  className={
                    statusFilter === value
                      ? "bg-teal-700 px-3 py-2 font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
                      : "px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={reload}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Actualiser
          </button>
        </div>
        <h2 id="waitlist-filter-heading" className="sr-only">
          Entrées en liste d&rsquo;attente
        </h2>

        {notice && (
          <p
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        <div aria-busy={loading}>
          {error ? (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <p role="alert" className="text-sm text-red-700">
                Impossible de charger la liste d&rsquo;attente.
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
            <ul className="space-y-2" aria-label="Chargement de la liste d'attente">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-14 animate-pulse rounded-md border border-slate-200 bg-slate-100"
                >
                  {i === 0 && <span className="sr-only">Chargement…</span>}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <WaitlistList entries={entries} onDeleted={handleDeleted} />
              {nextCursor && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700
                    hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-teal-600 focus-visible:ring-offset-2
                    disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Chargement…" : "Charger plus"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
