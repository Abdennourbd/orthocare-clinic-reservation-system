"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

// G3 — create/edit form for a patient case (before/after + extras + consent
// + home feature pick). FR-only. Images are set by URL paste or by file
// upload (POST /api/admin/cases/upload). Extras are managed here in edit
// mode only — a case must exist before pictures can be attached to it.

export type CaseExtra = {
  id: string;
  imageUrl: string;
  caption: Record<string, string>;
  sortOrder: number;
};

export type CaseRow = {
  id: string;
  key: string;
  title: Record<string, string>;
  description: Record<string, string>;
  beforeImageUrl: string;
  afterImageUrl: string;
  active: boolean;
  sortOrder: number;
  featured: boolean;
  featuredOrder: number;
  consentConfirmed: boolean;
  images: CaseExtra[];
  _count?: { images: number };
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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

function fr(v: unknown): string {
  if (v && typeof v === "object" && "fr" in (v as Record<string, unknown>)) {
    const s = (v as Record<string, unknown>).fr;
    return typeof s === "string" ? s : "";
  }
  return "";
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  return fallback;
}

async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Fichier trop volumineux (4 Mo maximum).");
  }
  const form = new FormData();
  form.append("file", file);
  form.append("declaredMimeType", file.type);
  const response = await fetch("/api/admin/cases/upload", { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(await readError(response, "Envoi impossible."));
  }
  const body = (await response.json()) as { url?: string };
  if (!body.url) throw new Error("Envoi impossible.");
  return body.url;
}

function ImageField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  disabled: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 text-sm text-slate-700">
      <label htmlFor={`case-${label}`}>{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
            Aucune
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            id={`case-${label}`}
            aria-label={label}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="/images/photo.jpg ou https://…"
            disabled={disabled}
          />
          <label className="text-xs text-slate-500">
            ou envoyer un fichier (JPEG, PNG, WebP — 4 Mo max){" "}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void onFile(e)}
              disabled={disabled || uploading}
              className="text-xs"
            />
          </label>
          {uploading ? <p className="text-xs text-slate-500">Envoi…</p> : null}
          {uploadError ? (
            <p role="alert" className="text-xs text-red-700">
              {uploadError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CaseForm({
  initial,
  featuredCount,
  onSaved,
  onCancel,
}: {
  initial: CaseRow | null;
  featuredCount: number;
  onSaved: (item: CaseRow) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [titleFr, setTitleFr] = useState(fr(initial?.title));
  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [descFr, setDescFr] = useState(fr(initial?.description));
  const [descAr, setDescAr] = useState("");
  const [descEn, setDescEn] = useState("");
  const [beforeUrl, setBeforeUrl] = useState(initial?.beforeImageUrl ?? "");
  const [afterUrl, setAfterUrl] = useState(initial?.afterImageUrl ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [featuredOrder, setFeaturedOrder] = useState(String(initial?.featuredOrder ?? 0));
  const [consent, setConsent] = useState(initial?.consentConfirmed ?? false);
  const [active, setActive] = useState(initial?.active ?? false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Extras (edit mode only).
  const [extras, setExtras] = useState<CaseExtra[]>(initial?.images ?? []);
  const [extraUrl, setExtraUrl] = useState("");
  const [extraCaption, setExtraCaption] = useState("");
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [confirmExtraId, setConfirmExtraId] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        key: key.trim(),
        title: { fr: titleFr.trim(), ...(titleAr.trim() ? { ar: titleAr.trim() } : {}), ...(titleEn.trim() ? { en: titleEn.trim() } : {}) },
        description: { fr: descFr.trim(), ...(descAr.trim() ? { ar: descAr.trim() } : {}), ...(descEn.trim() ? { en: descEn.trim() } : {}) },
        beforeImageUrl: beforeUrl.trim(),
        afterImageUrl: afterUrl.trim(),
        sortOrder: Number(sortOrder) || 0,
        featured,
        featuredOrder: Number(featuredOrder) || 0,
        consentConfirmed: consent,
        active,
      };
      const response = await fetch(initial ? `/api/admin/cases/${initial.id}` : "/api/admin/cases", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Enregistrement impossible."));
        return;
      }
      const saved = (await response.json()) as { item: CaseRow };
      onSaved({ ...saved.item, images: extras });
    } finally {
      setSaving(false);
    }
  };

  const addExtra = async (url: string) => {
    if (!initial) return;
    setExtraBusy(true);
    setExtraError(null);
    try {
      const response = await fetch(`/api/admin/cases/${initial.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url, caption: { fr: extraCaption.trim() || "Photo" } }),
      });
      if (!response.ok) {
        setExtraError(await readError(response, "Ajout impossible."));
        return;
      }
      const body = (await response.json()) as { image: CaseExtra };
      setExtras((prev) => [...prev, body.image]);
      setExtraUrl("");
      setExtraCaption("");
    } finally {
      setExtraBusy(false);
    }
  };

  const removeExtra = async (imageId: string) => {
    if (!initial) return;
    setExtraBusy(true);
    try {
      const response = await fetch(`/api/admin/cases/${initial.id}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      if (!response.ok) {
        setExtraError(await readError(response, "Suppression impossible."));
        return;
      }
      setExtras((prev) => prev.filter((x) => x.id !== imageId));
      setConfirmExtraId(null);
    } finally {
      setExtraBusy(false);
    }
  };

  const onExtraFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtraBusy(true);
    setExtraError(null);
    try {
      await addExtra(await uploadImage(file));
    } catch (err) {
      setExtraError(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setExtraBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">
        {initial ? `Modifier — ${fr(initial.title)}` : "Nouveau cas patient"}
      </h2>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Clé (identifiant unique)
        <input aria-label="Clé (identifiant unique)" className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex. encombrement-sara" required />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Ordre d&apos;affichage
        <input aria-label="Ordre d'affichage" className={inputClass} type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Titre (français)
        <input aria-label="Titre (français)" className={inputClass} value={titleFr} onChange={(e) => setTitleFr(e.target.value)} placeholder="ex. Encombrement sévère — 18 mois" required />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Titre (arabe, optionnel)
        <input aria-label="Titre (arabe)" className={inputClass} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} dir="auto" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
        Titre (anglais, optionnel)
        <input aria-label="Titre (anglais)" className={inputClass} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
        Description (français) — ce que le patient avait, comment nous l&apos;avons soigné
        <textarea aria-label="Description (français)" className={inputClass} rows={4} value={descFr} onChange={(e) => setDescFr(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Description (arabe, optionnel)
        <textarea aria-label="Description (arabe)" className={inputClass} rows={3} value={descAr} onChange={(e) => setDescAr(e.target.value)} dir="auto" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Description (anglais, optionnel)
        <textarea aria-label="Description (anglais)" className={inputClass} rows={3} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
      </label>

      <div className="sm:col-span-2">
        <ImageField label="URL photo avant" value={beforeUrl} onChange={setBeforeUrl} disabled={saving} />
      </div>
      <div className="sm:col-span-2">
        <ImageField label="URL photo après" value={afterUrl} onChange={setAfterUrl} disabled={saving} />
      </div>

      <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800 sm:col-span-2">
        <input
          type="checkbox"
          aria-label="Consentement écrit du patient obtenu"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Consentement écrit du patient obtenu (photos publiées sur le site public). Sans ce consentement, le cas reste un brouillon.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          aria-label="Publier (visible sur le site)"
          checked={active}
          disabled={!consent}
          onChange={(e) => setActive(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Publier (visible sur le site)
          {!consent ? <span className="block text-xs text-slate-500">Cochez d&apos;abord le consentement.</span> : null}
        </span>
      </label>

      <div className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          id="case-featured"
          checked={featured}
          onChange={(e) => setFeatured(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <label htmlFor="case-featured">Afficher sur la page d&apos;accueil ({featuredCount}/4)</label>
          <span className="flex items-center gap-2">
            Ordre :
            <input aria-label="Ordre à l'accueil" className={`${inputClass} w-20`} type="number" min={0} value={featuredOrder} onChange={(e) => setFeaturedOrder(e.target.value)} />
          </span>
        </span>
      </div>

      {initial ? (
        <fieldset className="rounded-md border border-slate-200 p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-medium text-slate-900">
            Photos supplémentaires ({extras.length}/8)
          </legend>
          {extras.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune photo supplémentaire.</p>
          ) : (
            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {extras.map((x) => (
                <li key={x.id} className="overflow-hidden rounded-md border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.imageUrl} alt={fr(x.caption)} className="h-20 w-full object-cover" loading="lazy" />
                  <div className="p-1.5">
                    <p className="truncate text-xs text-slate-700">{fr(x.caption)}</p>
                    {confirmExtraId === x.id ? (
                      <div className="mt-1 flex gap-1">
                        <button type="button" className={buttonSecondaryClass} disabled={extraBusy} onClick={() => void removeExtra(x.id)}>
                          Oui
                        </button>
                        <button type="button" className={buttonSecondaryClass} onClick={() => setConfirmExtraId(null)}>
                          Non
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="mt-1 text-xs text-red-700 underline" onClick={() => setConfirmExtraId(x.id)}>
                        Retirer
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {extras.length < 8 ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <input aria-label="URL photo supplémentaire" className={`${inputClass} flex-1`} value={extraUrl} onChange={(e) => setExtraUrl(e.target.value)} placeholder="/images/etape.jpg ou https://…" />
                <input aria-label="Légende photo supplémentaire" className={`${inputClass} flex-1`} value={extraCaption} onChange={(e) => setExtraCaption(e.target.value)} placeholder="Légende (ex. Pose de l'appareil)" />
                <button type="button" className={buttonSecondaryClass} disabled={extraBusy || !extraUrl.trim()} onClick={() => void addExtra(extraUrl.trim())}>
                  Ajouter
                </button>
              </div>
              <label className="text-xs text-slate-500">
                ou envoyer un fichier{" "}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void onExtraFile(e)} disabled={extraBusy} className="text-xs" />
              </label>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Maximum 8 photos supplémentaires atteint.</p>
          )}
          {extraError ? (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {extraError}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {formError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {formError}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={buttonPrimaryClass} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className={buttonSecondaryClass} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
