"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import SmsComposer from "./SmsComposer";
import type { WeekPatient } from "./WeekAppointmentsStrip";

// SMS pulse — 5 derniers messages (GET /api/admin/sms?limit=5) + compositeur
// rapide. Heures en DD/MM HH:mm heure du cabinet via clinicTime.ts uniquement
// (jamais le tz navigateur). Jamais de body/tél dans les logs.

interface PulseMessage {
  id: string;
  to: string;
  body: string;
  type: string;
  provider: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  patient: { id: string; firstName: string; lastName: string } | null;
}

const TYPE_LABELS: Record<string, string> = {
  BOOKING_RECEIVED: "Demande reçue",
  CONFIRMATION: "Confirmation",
  REMINDER: "Rappel",
  NO_SHOW: "Absent",
  MANUAL: "Manuel",
  RESCHEDULE: "Déplacement",
  CANCELLED: "Annulation",
  DELAY: "Retard",
  WAITLIST: "Liste d'attente",
  EXPIRED: "Expiration",
};

const STATUS_CLASSES: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-900",
  FAILED: "bg-red-100 text-red-900",
  SENDING: "bg-slate-200 text-slate-800",
};

const STATUS_LABELS: Record<string, string> = {
  SENT: "Envoyé",
  FAILED: "Échec",
  SENDING: "En cours",
  QUEUED: "En file",
  DELIVERED: "Reçu",
  UNDELIVERED: "Non distribué",
};

export function formatPulseTime(instant: string): string {
  const d = new Date(instant);
  const day = toClinicLocalDateString(d).split("-").reverse().slice(0, 2).join("/");
  return `${day} ${formatClinicLocalTime(d)}`;
}

export default function SmsPulsePanel({ patients }: { patients: WeekPatient[] }) {
  const [messages, setMessages] = useState<PulseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch("/api/admin/sms?limit=5", {
          signal: controller.signal,
        });
        if (!response.ok) {
          setError(true);
          return;
        }
        const data = (await response.json()) as { messages: PulseMessage[] };
        setMessages(data.messages);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reloadToken]);

  return (
    <section
      aria-labelledby="sms-pulse-heading"
      className="dash-enter flex min-h-0 flex-col rounded-2xl border border-cyan-100 bg-white p-4 shadow-[0_4px_24px_-12px_rgba(8,145,178,0.35)] sm:p-5"
      style={{ animationDelay: "200ms" }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="sms-pulse-heading" className="flex items-center gap-2 text-base font-bold text-cyan-950">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-emerald-600" fill="none">
            <path d="M2.5 4.5h15v9h-8l-4 3.5v-3.5h-3v-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Messages
        </h2>
        <Link
          href="/admin/sms"
          className="cursor-pointer text-xs font-semibold text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          Tout voir →
        </Link>
      </div>

      <div aria-busy={loading} className="mt-3">
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Impossible de charger les messages.{" "}
            <button
              type="button"
              onClick={() => setReloadToken((t) => t + 1)}
              className="cursor-pointer font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Réessayer
            </button>
          </p>
        ) : loading ? (
          <ul className="space-y-2" aria-label="Chargement des messages">
            {[0, 1, 2].map((i) => (
              <li key={i} role="status" aria-label="Chargement…" className="dash-skeleton h-12 rounded-xl" />
            ))}
          </ul>
        ) : messages.length === 0 ? (
          <p role="status" className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50/50 px-3 py-3 text-center text-sm text-slate-600">
            Aucun message envoyé pour l&apos;instant.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="dash-row rounded-xl border border-slate-200 p-2.5 text-sm transition-all duration-200 hover:border-cyan-200 hover:shadow-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-slate-900">
                    {m.patient ? `${m.patient.lastName} ${m.patient.firstName}` : "Patient supprimé"}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-px text-[11px] font-bold ${STATUS_CLASSES[m.status] ?? "bg-slate-200 text-slate-800"}`}
                  >
                    {STATUS_LABELS[m.status] ?? "Inconnu"}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-slate-500">
                    {formatPulseTime(m.sentAt ?? m.createdAt)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-slate-700" dir="auto">
                  <span className="mr-1.5 rounded bg-cyan-50 px-1.5 py-px text-[11px] font-semibold text-cyan-800 ring-1 ring-cyan-100">
                    {TYPE_LABELS[m.type] ?? m.type}
                  </span>
                  {m.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <SmsComposer patients={patients} onSent={() => setReloadToken((t) => t + 1)} />
      </div>
    </section>
  );
}
