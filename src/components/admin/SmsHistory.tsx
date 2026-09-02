"use client";

import { useEffect, useState } from "react";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 16 — SMS history for the dashboard (both roles). Two reads:
// GET /api/admin/sms/batches (broadcast lots, metadata only) at the top, and
// GET /api/admin/sms (cursor-paginated messages) below. A lot's "Filtrer"
// button narrows the message list to that batchId; both lists refetch when
// the shell bumps `reloadToken` (e.g. after a broadcast send).
//
// Message rows are patient-identifying content, exactly like the audit
// viewer's rows — same loading/empty/error conventions as AuditViewer.

interface BatchRow {
  id: string;
  date: string;
  delayMinutes: number;
  recipientCount: number;
  sentCount: number;
  suppressedCount: number;
  failedCount: number;
  createdAt: string;
  sentBy: { name: string };
}

interface MessageRow {
  id: string;
  to: string;
  body: string;
  type: string;
  batchId: string | null;
  provider: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  patient: { id: string; firstName: string; lastName: string } | null;
}

// All ten SmsMessageType values (src/schemas/sms.ts) mapped to French labels.
const TYPE_LABELS: Record<string, string> = {
  BOOKING_RECEIVED: "Demande reçue",
  CONFIRMATION: "Confirmation",
  REMINDER: "Rappel",
  NO_SHOW: "No-show",
  MANUAL: "Manuel",
  RESCHEDULE: "Déplacement",
  CANCELLED: "Annulation",
  DELAY: "Retard",
  WAITLIST: "Liste d'attente",
  EXPIRED: "Expiration",
};

// Status badge: color + TEXT, never color alone (same approach as
// AppointmentStatusBadge; bg-…-100 / text-…-900 pairs keep contrast > 4.5:1).
const STATUS_CLASSES: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-900",
  FAILED: "bg-red-100 text-red-900",
  SENDING: "bg-slate-200 text-slate-800",
};

const STATUS_LABELS: Record<string, string> = {
  SENT: "Envoyé",
  FAILED: "Échec",
  SENDING: "En cours",
};

const PAGE_SIZE = 50;

// Clinic-local "DD/MM/YYYY HH:mm" — composed from the two tz-aware helpers,
// exactly like AppointmentsDashboard builds its date labels.
function formatClinicDateTime(instant: string): string {
  const d = new Date(instant);
  return `${toClinicLocalDateString(d).split("-").reverse().join("/")} ${formatClinicLocalTime(d)}`;
}

export default function SmsHistory({ reloadToken }: { reloadToken: number }) {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchesError, setBatchesError] = useState(false);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/sms/batches?limit=50");
        if (cancelled) return;
        if (!response.ok) {
          setBatchesError(true);
          return;
        }
        const data = (await response.json()) as { batches: BatchRow[] };
        if (cancelled) return;
        setBatches(data.batches);
        setBatchesError(false);
      } catch {
        if (!cancelled) setBatchesError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (batchFilter) params.set("batchId", batchFilter);
      try {
        const response = await fetch(`/api/admin/sms?${params.toString()}`);
        if (cancelled) return;
        if (!response.ok) {
          setError(true);
          return;
        }
        const data = (await response.json()) as { messages: MessageRow[]; nextCursor: string | null };
        if (cancelled) return;
        setMessages(data.messages);
        setNextCursor(data.nextCursor);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchFilter, reloadToken]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: nextCursor });
    if (batchFilter) params.set("batchId", batchFilter);
    try {
      const response = await fetch(`/api/admin/sms?${params.toString()}`);
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = (await response.json()) as { messages: MessageRow[]; nextCursor: string | null };
      setMessages((current) => [...current, ...data.messages]);
      setNextCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="sms-batches-heading" className="space-y-3">
        <h2 id="sms-batches-heading" className="text-sm font-medium text-slate-700">
          Lots de diffusion
        </h2>

        {batchesError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Impossible de charger les lots de diffusion.
          </p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-slate-500" role="status">
            Aucun lot de diffusion.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Lots de diffusion des retards</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">Date visée</th>
                  <th scope="col" className="px-4 py-2">Retard</th>
                  <th scope="col" className="px-4 py-2">Envoyés / Total</th>
                  <th scope="col" className="px-4 py-2">Échecs</th>
                  <th scope="col" className="px-4 py-2">Par</th>
                  <th scope="col" className="px-4 py-2">Envoyé le</th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Filtrer les messages</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {b.date.split("-").reverse().join("/")}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{b.delayMinutes} min</td>
                    <td className="px-4 py-2 text-slate-600">
                      {b.sentCount} / {b.recipientCount}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{b.failedCount}</td>
                    <td className="px-4 py-2 text-slate-600">{b.sentBy.name}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {formatClinicDateTime(b.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setBatchFilter(b.id)}
                        aria-label={`Filtrer les messages du lot ${b.date.split("-").reverse().join("/")}`}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700
                          hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      >
                        Filtrer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="sms-messages-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sms-messages-heading" className="text-sm font-medium text-slate-700">
            Messages
          </h2>
          {batchFilter && (
            <button
              type="button"
              onClick={() => setBatchFilter(null)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700
                hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Tout afficher
            </button>
          )}
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Impossible de charger les messages.
          </p>
        ) : loading ? (
          <p className="text-sm text-slate-500" role="status">
            Chargement…
          </p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500" role="status">
            Aucun message.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => {
              const statusKey = m.status as keyof typeof STATUS_CLASSES;
              return (
                <li
                  key={m.id}
                  className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium text-slate-900">
                      {m.patient ? `${m.patient.lastName} ${m.patient.firstName}` : "Patient supprimé"}
                    </span>
                    <span className="text-slate-600" dir="auto">
                      {m.to}
                    </span>
                    <span className="text-xs text-slate-500">
                      {TYPE_LABELS[m.type] ?? m.type}
                    </span>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        STATUS_CLASSES[statusKey] ?? "bg-slate-200 text-slate-800"
                      }`}
                    >
                      {STATUS_LABELS[statusKey] ?? m.status}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">
                      {m.sentAt ? `Envoyé le ${formatClinicDateTime(m.sentAt)}` : "Pas encore envoyé"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-800" dir="auto">
                    {m.body}
                  </p>
                  {m.error && (
                    <p className="text-xs text-red-700">Erreur : {m.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && !loading && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700
              hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "Chargement…" : "Charger plus"}
          </button>
        )}
      </section>
    </div>
  );
}
