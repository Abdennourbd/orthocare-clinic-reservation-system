"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { documentUploadSchema } from "@/schemas/document";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/mime";
import type { SessionRole } from "@/lib/auth/session";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 15 step 5 — upload + list + download + delete UI for a patient's
// documents (radiographies), mounted by PatientDetail below AddVisitForm and
// hidden for an anonymized chart (the routes themselves also close on
// anonymized patients — hiding here is UX, never the access control, same
// rule as every PatientDetail child).
//
// Single source of truth: the shared `documentUploadSchema`
// (src/schemas/document.ts) validates the name + declared MIME type and the
// `MAX_DOCUMENT_BYTES` constant (src/lib/documents/mime.ts) gates the size
// client-side — this component never re-declares a limit or a type list
// (Definition of Done, tasks/todo.md:12). The byte-level validation itself
// (magic bytes, extension agreement) is server-side only — the client
// cannot look at anything more trustworthy than what the browser declared.
//
// `blobKey` is never displayed, logged or stored here: the list payload and
// the upload response are metadata whitelists that do not contain it, and
// the download goes through a plain <a href> to
// GET /api/admin/documents/[id], which sets Content-Disposition itself —
// no fetch-and-blob dance, so the file never even transits this
// component's JS.
//
// The delete is the screen's third destructive action and follows the same
// inline two-step confirm pattern as PatientDetail's deactivation gate (no
// modal, no window.confirm). The button is rendered for ADMIN only —
// DELETE /api/admin/documents/[id] independently requires ADMIN, so a
// RECEPTIONIST gets a 403 regardless.
//
// List states mirror PatientTimeline (loading / error + Réessayer / 429
// without a Réessayer button — same shared `patients-read` budget reasoning,
// see that component's comment).

interface DocumentItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

/** Human wording for the size cap, derived FROM the constant — never a
 * second declaration of the limit. */
const MAX_DOCUMENT_MO = Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024));
const SIZE_ERROR_MESSAGE = `Le fichier dépasse la taille maximale de ${MAX_DOCUMENT_MO} Mo.`;
const NETWORK_ERROR_MESSAGE =
  "Impossible de joindre le serveur. Vérifiez la connexion et réessayez.";
const RATE_LIMIT_MESSAGE = "Trop de requêtes. Réessayez plus tard.";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const labelClass = "block text-sm font-medium text-slate-700";
const errorTextClass = "text-xs text-red-700";

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} o`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} Ko`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDocumentDate(iso: string): string {
  const date = new Date(iso);
  const [year, month, day] = toClinicLocalDateString(date).split("-");
  return `${day}/${month}/${year} à ${formatClinicLocalTime(date)}`;
}

export default function PatientDocuments({
  patientId,
  role,
}: {
  patientId: string;
  role: SessionRole;
}) {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [listToken, setListToken] = useState(0);

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; file?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setListError(false);
      setRateLimited(false);
      try {
        const response = await fetch(`/api/admin/patients/${patientId}/documents`);
        if (cancelled) return;
        // Same 429 handling as PatientTimeline — no Réessayer button, the
        // shared `patients-read` budget refills on its own.
        if (response.status === 429) {
          setRateLimited(true);
          return;
        }
        if (!response.ok) {
          setListError(true);
          return;
        }
        const body = (await response.json()) as { items: DocumentItem[] };
        if (cancelled) return;
        setItems(body.items);
      } catch {
        if (!cancelled) setListError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, listToken]);

  const refreshList = useCallback(() => setListToken((t) => t + 1), []);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setSuccessMessage(null);

    if (!file) {
      setFieldErrors({ file: "Le fichier est requis." });
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFieldErrors({ file: SIZE_ERROR_MESSAGE });
      return;
    }
    // The file's browser-declared Content-Type is the `declaredMimeType` the
    // POST route expects; the shared schema rejects anything outside the
    // allow-list before a single byte leaves the page.
    const parsed = documentUploadSchema.safeParse({ name, declaredMimeType: file.type });
    if (!parsed.success) {
      const next: { name?: string; file?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "name") next.name = issue.message;
        if (issue.path[0] === "declaredMimeType") next.file = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setPending(true);
    try {
      const formData = new FormData();
      formData.set("name", parsed.data.name);
      formData.set("declaredMimeType", parsed.data.declaredMimeType);
      formData.set("file", file);

      const response = await fetch(`/api/admin/patients/${patientId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        setName("");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setSuccessMessage("Document ajouté.");
        refreshList();
        return;
      }
      const body = await response.json().catch(() => null);
      if (response.status === 429) {
        setFormError(RATE_LIMIT_MESSAGE);
        return;
      }
      setFormError((body?.error?.message as string | undefined) ?? "Une erreur est survenue. Réessayez.");
    } catch {
      setFormError(NETWORK_ERROR_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteConfirmId || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/documents/${deleteConfirmId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setDeleteConfirmId(null);
        setSuccessMessage("Document supprimé.");
        refreshList();
        return;
      }
      const body = await response.json().catch(() => null);
      if (response.status === 429) {
        setDeleteError(RATE_LIMIT_MESSAGE);
        return;
      }
      // 404 (already gone) and any other status share this generic message —
      // same FR error envelope as everywhere else on this screen.
      setDeleteError(
        (body?.error?.message as string | undefined) ?? "Impossible de supprimer ce document.",
      );
    } catch {
      setDeleteError(NETWORK_ERROR_MESSAGE);
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="space-y-6" aria-busy={loading || pending || deletePending}>
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Documents du patient</h2>

        {rateLimited ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p role="alert" className="text-sm text-amber-800">
              Trop de consultations de dossiers en peu de temps. Réessayez dans quelques minutes.
            </p>
          </div>
        ) : listError ? (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">
              Impossible de charger les documents de ce patient.
            </p>
            <button
              type="button"
              onClick={refreshList}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
                hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Réessayer
            </button>
          </div>
        ) : loading ? (
          <ul className="space-y-2" role="status">
            <span className="sr-only">Chargement des documents…</span>
            {[0, 1].map((i) => (
              <li
                key={i}
                className="h-14 animate-pulse rounded-md border border-slate-200 bg-slate-100"
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500" role="status">
            Aucun document pour ce patient.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((doc) => (
              <li
                key={doc.id}
                className="space-y-2 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium text-slate-900" dir="auto">
                      {doc.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatSize(doc.sizeBytes)} — ajouté le {formatDocumentDate(doc.uploadedAt)}
                      {doc.uploadedBy ? ` par ${doc.uploadedBy}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {/* The download route sets Content-Disposition itself;
                        the file never transits this component's JS. */}
                    <a
                      href={`/api/admin/documents/${doc.id}`}
                      download
                      className="rounded-md border border-teal-600 px-3 py-1.5 text-sm font-medium text-teal-700
                        hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      Télécharger
                    </a>
                    {role === "ADMIN" && deleteConfirmId !== doc.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmId(doc.id);
                          setDeleteError(null);
                        }}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
                          hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>

                {deleteConfirmId === doc.id && (
                  <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <p role="alert" className="text-sm text-red-800">
                      Supprimer définitivement ce document ? Cette action est irréversible.
                    </p>
                    {deleteError && <p className="text-sm text-red-700">{deleteError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleDeleteConfirm}
                        disabled={deletePending}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white
                          hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2
                          disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletePending ? "Suppression…" : "Confirmer la suppression"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmId(null);
                          setDeleteError(null);
                        }}
                        disabled={deletePending}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800
                          hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2
                          disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Ajouter un document</h3>
        <p className="text-xs text-slate-500">
          Radiographie ou autre document du patient (JPEG, PNG, PDF, DICOM — {MAX_DOCUMENT_MO} Mo
          maximum). Le nom doit inclure l&rsquo;extension du fichier (ex.&nbsp;radio.jpg).
        </p>

        {formError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
        {successMessage && (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {successMessage}
          </p>
        )}

        <form className="space-y-3" onSubmit={handleUpload} noValidate>
          <div className="space-y-1">
            <label htmlFor="document-name" className={labelClass}>
              Nom du document
            </label>
            <input
              id="document-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="auto"
              autoComplete="off"
              aria-describedby={fieldErrors.name ? "document-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
              className={inputClass}
            />
            {fieldErrors.name && (
              <p id="document-name-error" className={errorTextClass}>
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="document-file" className={labelClass}>
              Fichier
            </label>
            <input
              id="document-file"
              type="file"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby={fieldErrors.file ? "document-file-error" : undefined}
              aria-invalid={Boolean(fieldErrors.file)}
              className={inputClass}
            />
            {fieldErrors.file && (
              <p id="document-file-error" className={errorTextClass}>
                {fieldErrors.file}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
              hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Envoi…" : "Envoyer le document"}
          </button>
        </form>
      </section>
    </div>
  );
}
