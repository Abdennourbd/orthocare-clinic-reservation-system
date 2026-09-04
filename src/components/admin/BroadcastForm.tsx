"use client";

import { useState, type FormEvent } from "react";
import { toClinicLocalDateString, formatClinicLocalTime } from "@/lib/time/clinicTime";
import type { SmsBanner } from "./SmsCenter";

// Task 16 — delay broadcast (ADMIN only, rendered by SmsCenter only for
// ADMIN — the server page is the real gate and the API routes re-check).
// Two-step flow where the PREVIEW IS the confirmation: POST …/preview shows
// exactly who would be messaged (audience + exclusions + sample body), and
// only then does "Envoyer la diffusion" appear.
//
// Double-click safety is two layers: (1) an idempotencyKey minted ONCE at
// preview time and kept in state — the server dedupes on it, so a retried
// POST lands on the same batch and sends nothing; (2) the submit button is
// disabled while pending. Any change to date/delayMinutes invalidates BOTH
// the preview result and the stored key: a stale preview must never confirm
// a broadcast whose audience has changed.

interface Recipient {
  appointmentId: string;
  patientId: string;
  firstName: string;
  lastName: string;
  startTime: string;
  phone: string;
}

interface PreviewResult {
  date: string;
  delayMinutes: number;
  recipientCount: number;
  recipients: Recipient[];
  excluded: Array<{ appointmentId: string; reason: string }>;
  sampleBody: string;
}

// BroadcastExclusionReason values (src/lib/messaging/smsCenter.ts) mapped to
// French labels for the Exclus list — color is never the only carrier of
// meaning, the reason is spelled out.
const EXCLUSION_LABELS: Record<string, string> = {
  CANCELLED: "annulé",
  RESCHEDULED: "déplacé",
  COMPLETED: "terminé",
  NO_SHOW: "absent",
  OPTED_OUT: "opposé aux messages",
  INACTIVE: "patient inactif",
};

// v4 UUID for the idempotencyKey. `crypto.randomUUID` is the primary path
// (Node 18+, modern browsers); jsdom's crypto lacks it, so the fallback
// builds the same v4 shape from getRandomValues bytes (version/variant bits
// set). The server only requires a unique 8-100 char string.
function mintIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const labelClass = "block text-sm font-medium text-slate-700";
const buttonPrimary =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const buttonNeutral =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export default function BroadcastForm({
  onNotify,
  onSent,
}: {
  onNotify: (banner: SmsBanner) => void;
  onSent: () => void;
}) {
  // "Today" is the CLINIC's today (Africa/Algiers), computed by the only
  // tz-aware module — same convention as ManualBookingForm's date default.
  const [date, setDate] = useState(() => toClinicLocalDateString(new Date()));
  const [delayInput, setDelayInput] = useState("15");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function clearPreview() {
    setPreview(null);
    setIdempotencyKey(null);
  }

  function parseDelay(): number | null {
    const delay = Number(delayInput);
    if (!Number.isInteger(delay) || delay < 1 || delay > 480) return null;
    return delay;
  }

  async function runPreview() {
    const delay = parseDelay();
    if (delay === null) {
      setFormError("La durée doit être d'au moins 1 minute (480 maximum).");
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/sms/broadcast/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, delayMinutes: delay }),
      });
      const data = (await response.json().catch(() => null)) as
        | (PreviewResult & { error?: { message?: string } })
        | null;
      if (!response.ok || !data || data.error) {
        setFormError(data?.error?.message ?? "Aperçu impossible. Réessayez.");
        return;
      }
      setPreview(data);
      // Minted once per preview: the SAME key is what the send carries, so a
      // double-clicked send dedupes server-side on the batch row.
      setIdempotencyKey(mintIdempotencyKey());
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  async function sendBroadcast() {
    if (!preview || !idempotencyKey) return;
    const delay = parseDelay();
    if (delay === null) {
      setFormError("La durée doit être d'au moins 1 minute (480 maximum).");
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/sms/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: preview.date, delayMinutes: delay, idempotencyKey }),
      });
      const data = (await response.json().catch(() => null)) as {
        batchId?: string;
        sentCount?: number;
        suppressedCount?: number;
        failedCount?: number;
        alreadySent?: boolean;
        error?: { message?: string };
      } | null;
      if (!response.ok || !data || data.error) {
        setFormError(data?.error?.message ?? "Envoi impossible. Réessayez.");
        return;
      }
      if (data.alreadySent) {
        onNotify({ kind: "info", message: "Diffusion déjà envoyée (double-clic ignoré)." });
      } else {
        onNotify({
          kind: "success",
          message: `${data.sentCount} envoyé(s), ${data.suppressedCount} ignoré(s), ${data.failedCount} échec(s) — lot ${String(data.batchId).slice(0, 8)}`,
        });
      }
      // The batch is done either way: drop the preview and its key so a
      // second send always requires a fresh confirmation.
      clearPreview();
      onSent();
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runPreview();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Diffusion des retards</h2>

      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label htmlFor="broadcast-date" className={labelClass}>
            Date visée (heure du cabinet)
          </label>
          <input
            id="broadcast-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              clearPreview();
            }}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="broadcast-delay" className={labelClass}>
            Retard (minutes)
          </label>
          <input
            id="broadcast-delay"
            type="number"
            min={1}
            max={480}
            value={delayInput}
            onChange={(e) => {
              setDelayInput(e.target.value);
              clearPreview();
            }}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className={buttonNeutral}
        >
          {pending && !preview ? "Aperçu…" : "Aperçu"}
        </button>
      </form>

      {preview && (
        <section aria-labelledby="broadcast-preview-heading" className="space-y-3">
          <h3 id="broadcast-preview-heading" className="text-sm font-medium text-slate-700">
            Aperçu de la diffusion
          </h3>

          <p className="text-base font-semibold text-slate-900" role="status">
            {preview.recipientCount} destinataire(s)
          </p>

          {preview.recipients.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 shadow-sm">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Patients destinataires de la diffusion</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2">Nom</th>
                    <th scope="col" className="px-4 py-2">Heure</th>
                    <th scope="col" className="px-4 py-2">Téléphone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {preview.recipients.map((r) => (
                    <tr key={r.appointmentId}>
                      <td className="px-4 py-2 text-slate-700">
                        {r.lastName} {r.firstName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {formatClinicLocalTime(new Date(r.startTime))}
                      </td>
                      <td className="px-4 py-2 text-slate-600" dir="auto">
                        {r.phone}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            // Zero-recipient day: the Exclus list above stays visible (it IS
            // the audit of who was filtered out) but there is nothing to
            // send, so the send button below is disabled too.
            <p className="text-sm text-slate-500" role="status">
              Aucun destinataire pour cette date.
            </p>
          )}

          {preview.excluded.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-slate-700">Exclus</h4>
              <ul className="space-y-1 text-sm text-slate-600">
                {preview.excluded.map((e) => (
                  <li key={e.appointmentId}>
                    <span className="font-mono text-xs">#{e.appointmentId.slice(0, 8)}</span> —{" "}
                    <span>{EXCLUSION_LABELS[e.reason] ?? e.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1">
            <h4 className="text-sm font-medium text-slate-700">Exemple de message</h4>
            <blockquote className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              « {preview.sampleBody} »
            </blockquote>
          </div>

          <button
            type="button"
            onClick={() => void sendBroadcast()}
            disabled={pending || preview.recipientCount === 0}
            className={buttonPrimary}
          >
            {pending ? "Envoi…" : "Envoyer la diffusion"}
          </button>
        </section>
      )}
    </div>
  );
}
