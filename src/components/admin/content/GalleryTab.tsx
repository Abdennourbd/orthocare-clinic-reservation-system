"use client";

import { useEffect, useState, type FormEvent } from "react";
import ConfirmPanel from "@/components/admin/ConfirmPanel";

// Task 21 — gallery tab (ADMIN): list, add by URL, show/hide, delete.
// v1 is URL-paste only (images already in public/images or the Blob store).

type GalleryItem = {
  id: string;
  key: string;
  imageUrl: string;
  caption: Record<string, string>;
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

export default function GalleryTab() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [creating, setCreating] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Inline two-step delete confirm (never window.confirm).
  const [confirmDelete, setConfirmDelete] = useState<GalleryItem | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/gallery");
      if (!response.ok) {
        setItems([]);
          setLoadError("Impossible de charger de la galerie.");
        return;
      }
      const body = (await response.json()) as { gallery: GalleryItem[] };
      setLoadError(null);
      setItems(body.gallery);
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
        const response = await fetch("/api/admin/gallery");
        if (cancelled || !response.ok) {
          if (!cancelled) {
            setItems([]);
            setLoadError("Impossible de charger de la galerie.");
          }
          return;
        }
        const body = (await response.json()) as { gallery: GalleryItem[] };
        if (!cancelled) setItems(body.gallery);
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
      const response = await fetch("/api/admin/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          imageUrl: imageUrl.trim(),
          caption: { fr: caption.trim() },
        }),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Ajout impossible."));
        return;
      }
      setKey("");
      setImageUrl("");
      setCaption("");
      setNotice("Image ajoutée.");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (g: GalleryItem) => {
    setRowBusy(g.id);
    setConfirmError(null);
    try {
      await fetch(`/api/admin/gallery/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !g.active }),
      });
      setNotice(g.active ? "Image masquée." : "Image affichée.");
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (g: GalleryItem) => {
    setRowBusy(g.id);
    try {
      const response = await fetch(`/api/admin/gallery/${g.id}`, { method: "DELETE" });
      if (!response.ok) {
        setConfirmError(await readError(response, "Suppression impossible."));
        return;
      }
      setNotice("Image supprimée.");
      setConfirmDelete(null);
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Chargement de la galerie">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Galerie">
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
        <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Nouvelle image</h2>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Clé (identifiant unique)
          <input aria-label="Clé" className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex. g13" required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Légende
          <input aria-label="Légende" className={inputClass} value={caption} onChange={(e) => setCaption(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          URL de l&apos;image (ex. /images/smile.jpg)
          <input aria-label="URL de l'image" className={inputClass} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="/images/smile.jpg" required />
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
          Aucune image.
        </div>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(items ?? []).map((g) => (
          <li key={g.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.imageUrl} alt={fr(g.caption)} className="h-40 w-full object-cover" loading="lazy" />
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-medium text-slate-900">
                {fr(g.caption)} <span className="font-normal text-slate-500">· {g.key}</span>
              </p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.active ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"}`}>
                  {g.active ? "Visible" : "Masquée"}
                </span>
                <button type="button" className={buttonSecondaryClass} disabled={rowBusy === g.id} onClick={() => void toggle(g)}>
                  {g.active ? "Masquer" : "Afficher"}
                </button>
                <button type="button" className={buttonSecondaryClass} disabled={rowBusy === g.id} onClick={() => { setConfirmDelete(g); setConfirmError(null); }}>
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
            message="Supprimer cette image ?"
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
