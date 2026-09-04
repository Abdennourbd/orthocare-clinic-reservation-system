"use client";

import { useEffect, useState, type FormEvent } from "react";
import ConfirmPanel from "@/components/admin/ConfirmPanel";

// Task 21 — services tab (ADMIN): list, create, edit duration/price/active,
// delete (blocked when upcoming appointments exist). FR plain language:
// "Durée (minutes)" rather than `durationMinutes`.

type Service = {
  id: string;
  slug: string;
  name: Record<string, string>;
  description: Record<string, string>;
  durationMinutes: number;
  price: number | null;
  currency: string;
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
    // Non-JSON — fall through.
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

export default function ServicesTab() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [nameFr, setNameFr] = useState("");
  const [descFr, setDescFr] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("");
  const [creating, setCreating] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Inline two-step delete confirm (never window.confirm).
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/services");
      if (!response.ok) {
        setLoadError("Impossible de charger les services.");
        setServices(null);
        return;
      }
      const body = (await response.json()) as { services: Service[] };
      setServices(body.services);
    } catch {
      setLoadError("Impossible de charger les services.");
      setServices(null);
    } finally {
      setLoading(false);
    }
  };

  // Initial read on mount (same inline-IIFE + cancelled-flag shape as
  // TeamDashboard/WaitlistDashboard — the fetch never lives in a callback
  // the effect would call).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/admin/services");
        if (cancelled || !response.ok) {
          if (!cancelled) {
            setLoadError("Impossible de charger les services.");
            setServices(null);
          }
          return;
        }
        const body = (await response.json()) as { services: Service[] };
        if (!cancelled) setServices(body.services);
      } catch {
        if (!cancelled) {
          setLoadError("Impossible de charger les services.");
          setServices(null);
        }
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
      const response = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          name: { fr: nameFr.trim() },
          description: { fr: descFr.trim() },
          durationMinutes: Number(duration),
          ...(price.trim() === "" ? {} : { price: Number(price) }),
        }),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Création impossible."));
        return;
      }
      setSlug("");
      setNameFr("");
      setDescFr("");
      setDuration("30");
      setPrice("");
      setNotice("Service créé.");
      await load();
    } catch {
      setFormError("Création impossible.");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (s: Service) => {
    setRowBusy(s.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/services/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !s.active }),
      });
      if (!response.ok) {
        setNotice(await readError(response, "Modification impossible."));
        return;
      }
      setNotice(s.active ? "Service désactivé." : "Service réactivé.");
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (s: Service) => {
    setRowBusy(s.id);
    setConfirmError(null);
    try {
      const response = await fetch(`/api/admin/services/${s.id}`, { method: "DELETE" });
      if (!response.ok) {
        setConfirmError(await readError(response, "Suppression impossible."));
        return;
      }
      setNotice("Service supprimé.");
      setConfirmDelete(null);
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Chargement des services">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Services">
      {loadError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
        <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Nouveau service</h2>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Identifiant (slug)
          <input aria-label="Identifiant" className={inputClass} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ex. consultation" required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Durée (minutes)
          <input aria-label="Durée en minutes" className={inputClass} value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Nom (français)
          <input aria-label="Nom en français" className={inputClass} value={nameFr} onChange={(e) => setNameFr(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Prix (DA, vide = non affiché)
          <input aria-label="Prix" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="ex. 2000" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          Description (français)
          <textarea aria-label="Description en français" className={inputClass} value={descFr} onChange={(e) => setDescFr(e.target.value)} rows={2} required />
        </label>
        {formError ? (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {formError}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button type="submit" className={buttonPrimaryClass} disabled={creating}>
            {creating ? "Création…" : "Créer le service"}
          </button>
        </div>
      </form>

      {services && services.length === 0 ? (
        <div role="status" className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Aucun service pour le moment.
        </div>
      ) : null}

      <ul className="space-y-2">
        {(services ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {fr(s.name)}{" "}
                <span className="font-normal text-slate-500">· {s.durationMinutes} min{s.price ? ` · ${s.price} DA` : ""}</span>
              </p>
              <p className="truncate text-xs text-slate-500">
                {s.slug} · {s.active ? "visible sur le site" : "masqué"}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.active ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"}`}
            >
              {s.active ? "Actif" : "Inactif"}
            </span>
            <button type="button" className={buttonSecondaryClass} disabled={rowBusy === s.id} onClick={() => void toggleActive(s)}>
              {s.active ? "Masquer" : "Afficher"}
            </button>
            <button type="button" className={buttonSecondaryClass} disabled={rowBusy === s.id} onClick={() => { setConfirmDelete(s); setConfirmError(null); }}>
              Supprimer
            </button>
          </li>
        ))}
      </ul>
      {confirmDelete ? (
        <div className="mt-2">
          <ConfirmPanel
            message={`Supprimer « ${fr(confirmDelete.name)} » ? Préférez la désactivation si un doute.`}
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
      <p className="mt-3 text-xs text-slate-500">
        La durée modifie les créneaux proposés dès la prochaine recherche. La suppression est refusée tant que des rendez-vous sont liés à ce service — masquez-le plutôt.
      </p>
    </section>
  );
}
