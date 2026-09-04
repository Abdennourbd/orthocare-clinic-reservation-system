"use client";

import { useEffect, useState, type FormEvent } from "react";
import ConfirmPanel from "@/components/admin/ConfirmPanel";

// Task 21 — FAQ tab (ADMIN): list, create, show/hide, delete.

type Faq = {
  id: string;
  key: string;
  question: Record<string, string>;
  answer: Record<string, string>;
  active: boolean;
};

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

const buttonPrimaryClass =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonSecondaryClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 " +
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

export default function FaqsTab() {
  const [items, setItems] = useState<Faq[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [creating, setCreating] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Inline two-step delete confirm (never window.confirm).
  const [confirmDelete, setConfirmDelete] = useState<Faq | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/faqs");
      if (!response.ok) {
        setItems([]);
          setLoadError("Impossible de charger des questions.");
        return;
      }
      const body = (await response.json()) as { faqs: Faq[] };
      setLoadError(null);
      setItems(body.faqs);
    } finally {
      setLoading(false);
    }
  };

  // Initial read on mount (same inline-IIFE + cancelled-flag shape as
  // TeamDashboard — the fetch never lives in a callback the effect calls).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/faqs");
        if (cancelled || !response.ok) {
          if (!cancelled) {
            setItems([]);
            setLoadError("Impossible de charger des questions.");
          }
          return;
        }
        const body = (await response.json()) as { faqs: Faq[] };
        if (!cancelled) setItems(body.faqs);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          question: { fr: question.trim() },
          answer: { fr: answer.trim() },
        }),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Création impossible."));
        return;
      }
      setKey("");
      setQuestion("");
      setAnswer("");
      setNotice("Question ajoutée.");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (f: Faq) => {
    setRowBusy(f.id);
    setConfirmError(null);
    try {
      await fetch(`/api/admin/faqs/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !f.active }),
      });
      setNotice(f.active ? "Question masquée." : "Question affichée.");
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (f: Faq) => {
    setRowBusy(f.id);
    try {
      const response = await fetch(`/api/admin/faqs/${f.id}`, { method: "DELETE" });
      if (!response.ok) {
        setConfirmError(await readError(response, "Suppression impossible."));
        return;
      }
      setNotice("Question supprimée.");
      setConfirmDelete(null);
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Chargement des questions">
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Questions fréquentes">
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
      <form onSubmit={create} className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Nouvelle question</h2>
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          Clé (identifiant unique)
          <input aria-label="Clé" className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex. f6" required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          Question
          <input aria-label="Question" className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          Réponse
          <textarea aria-label="Réponse" className={inputClass} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} required />
        </label>
        {formError ? (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {formError}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button type="submit" className={buttonPrimaryClass} disabled={creating}>
            {creating ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </form>
      {(items ?? []).length === 0 ? (
        <div role="status" className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Aucune question.
        </div>
      ) : null}
      <ul className="space-y-2">
        {(items ?? []).map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {fr(f.question)} <span className="font-normal text-slate-500">· {f.key}</span>
              </p>
              <p className="line-clamp-2 text-xs text-slate-600">{fr(f.answer)}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.active ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"}`}>
              {f.active ? "Visible" : "Masquée"}
            </span>
            <button type="button" className={buttonSecondaryClass} disabled={rowBusy === f.id} onClick={() => void toggle(f)}>
              {f.active ? "Masquer" : "Afficher"}
            </button>
            <button type="button" className={buttonSecondaryClass} disabled={rowBusy === f.id} onClick={() => { setConfirmDelete(f); setConfirmError(null); }}>
              Supprimer
            </button>
          </li>
        ))}
      </ul>
      {confirmDelete ? (
        <div className="mt-2">
          <ConfirmPanel
            message="Supprimer cette question ?"
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
