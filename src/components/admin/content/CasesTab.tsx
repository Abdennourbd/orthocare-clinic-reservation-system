"use client";

import { useEffect, useState } from "react";
import ConfirmPanel from "@/components/admin/ConfirmPanel";
import CaseForm, { type CaseRow } from "./CaseForm";

// G3 — "Cas patients" tab (ADMIN): list, create/edit with before/after
// pickers, extras, consent gate, home-feature pick (max 4), show/hide,
// delete. Same visual language as GalleryTab; form stays open above the
// list so the admin keeps context while editing.

const buttonSecondaryClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonPrimaryClass =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  return fallback;
}

function fr(v: unknown): string {
  if (v && typeof v === "object" && "fr" in (v as Record<string, unknown>)) {
    const s = (v as Record<string, unknown>).fr;
    return typeof s === "string" ? s : "";
  }
  return "";
}

export default function CasesTab() {
  const [items, setItems] = useState<CaseRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CaseRow | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CaseRow | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/cases");
      if (!response.ok) {
        setItems([]);
        setLoadError("Impossible de charger les cas patients.");
        return;
      }
      const body = (await response.json()) as { cases: CaseRow[] };
      setLoadError(null);
      setItems(body.cases);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/cases");
        if (cancelled || !response.ok) {
          if (!cancelled) {
            setItems([]);
            setLoadError("Impossible de charger les cas patients.");
          }
          return;
        }
        const body = (await response.json()) as { cases: CaseRow[] };
        if (!cancelled) setItems(body.cases);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const featuredCount = (items ?? []).filter((c) => c.featured).length;

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
    setNotice(null);
  };

  const openEdit = (c: CaseRow) => {
    setEditing(c);
    setShowForm(true);
    setNotice(null);
  };

  const onSaved = (item: CaseRow) => {
    setShowForm(false);
    setEditing(null);
    setNotice(`Cas « ${fr(item.title) || item.key} » enregistré.`);
    void load();
  };

  const toggleActive = async (c: CaseRow) => {
    setRowBusy(c.id);
    setRowError(null);
    try {
      const response = await fetch(`/api/admin/cases/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !c.active }),
      });
      if (!response.ok) {
        setRowError(await readError(response, "Modification impossible."));
        return;
      }
      setNotice(c.active ? "Cas masqué du site." : "Cas publié sur le site.");
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (c: CaseRow) => {
    setRowBusy(c.id);
    try {
      const response = await fetch(`/api/admin/cases/${c.id}`, { method: "DELETE" });
      if (!response.ok) {
        setConfirmError(await readError(response, "Suppression impossible."));
        return;
      }
      setNotice("Cas supprimé.");
      setConfirmDelete(null);
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Chargement des cas patients">
        {[0, 1].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Cas patients">
      {loadError ? (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {loadError}{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Réessayer
          </button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          {notice}
        </div>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {rowError}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimaryClass} onClick={openCreate}>
          Nouveau cas
        </button>
        <span className="text-sm text-slate-600" aria-live="polite">
          {featuredCount}/4 à l&apos;accueil
        </span>
      </div>

      {showForm ? (
        <CaseForm
          initial={editing}
          featuredCount={featuredCount - (editing?.featured ? 1 : 0)}
          onSaved={onSaved}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      ) : null}

      {(items ?? []).length === 0 ? (
        <div role="status" className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Aucun cas patient pour le moment.
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(items ?? []).map((c) => (
          <li key={c.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="grid grid-cols-2 gap-px bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.beforeImageUrl} alt="" className="h-28 w-full object-cover" loading="lazy" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.afterImageUrl} alt="" className="h-28 w-full object-cover" loading="lazy" />
            </div>
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-medium text-slate-900">
                {fr(c.title) || c.key} <span className="font-normal text-slate-500">· {c.key}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"}`}>
                  {c.active ? "Visible" : "Masquée"}
                </span>
                {c.featured ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Accueil
                  </span>
                ) : null}
                {!c.consentConfirmed ? (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    Sans consentement
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={buttonSecondaryClass} onClick={() => openEdit(c)}>
                  Modifier
                </button>
                <button type="button" className={buttonSecondaryClass} disabled={rowBusy === c.id} onClick={() => void toggleActive(c)}>
                  {c.active ? "Masquer" : "Afficher"}
                </button>
                <button type="button" className={buttonSecondaryClass} disabled={rowBusy === c.id} onClick={() => { setConfirmDelete(c); setConfirmError(null); }}>
                  Supprimer
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {confirmDelete ? (
        <div className="mt-2">
          <ConfirmPanel
            message={`Supprimer le cas « ${fr(confirmDelete.title) || confirmDelete.key} » et toutes ses photos ?`}
            confirmLabel="Oui, supprimer"
            pendingLabel="Suppression…"
            pending={rowBusy === confirmDelete.id}
            error={confirmError}
            onConfirm={() => void remove(confirmDelete)}
            onCancel={() => {
              setConfirmDelete(null);
              setConfirmError(null);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
