"use client";

import { useState, type FormEvent } from "react";
import type { WeekPatient } from "./WeekAppointmentsStrip";

// Quick SMS composer — reuses POST /api/admin/sms/single as-is.
// Patients come from the loaded week (prop, no extra search fetch).
// 480-char bound mirrors singleSmsSchema; the server re-validates.

const SMS_MAX = 480;

export default function SmsComposer({
  patients,
  onSent,
}: {
  patients: WeekPatient[];
  onSent: () => void;
}) {
  const [patientId, setPatientId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) {
      setError("Choisissez un patient de la semaine.");
      return;
    }
    if (!body.trim()) {
      setError("Le message est requis.");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/sms/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, body: body.trim() }),
      });
      const data = (await response.json().catch(() => null)) as {
        sent?: boolean;
        status?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? "Une erreur est survenue. Réessayez.");
        return;
      }
      if (data === null) {
        setError("Une erreur inattendue s'est produite lors de la lecture de la réponse.");
        return;
      }
      
      if (data.sent) {
        const picked = patients.find((p) => p.id === patientId);
        setSuccess(
          picked ? `SMS envoyé à ${picked.firstName} ${picked.lastName}.` : "SMS envoyé.",
        );
        setBody("");
        onSent();
      } else if (data?.status) {
        setError(`Échec d'envoi (statut : ${data.status}).`);
      } else {
        setError("Échec d'envoi : ce patient est opposé aux messages.");
      }
    } catch {
      setError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-cyan-100 bg-cyan-50/50 p-3">
      <h3 className="text-sm font-bold text-cyan-950">Envoi rapide</h3>
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
          {success}
        </p>
      )}
      <div className="space-y-1">
        <label htmlFor="quick-sms-patient" className="block text-xs font-medium text-slate-600">
          Patient de la semaine
        </label>
        <select
          id="quick-sms-patient"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          disabled={pending || patients.length === 0}
          className="w-full cursor-pointer rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-sm text-cyan-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">
            {patients.length === 0 ? "Aucun patient cette semaine" : "Choisir…"}
          </option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.lastName} {p.firstName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <label htmlFor="quick-sms-body" className="block text-xs font-medium text-slate-600">
            Message
          </label>
          <span aria-hidden="true" className="text-[11px] text-slate-500">
            {body.length} / {SMS_MAX}
          </span>
        </div>
        <textarea
          id="quick-sms-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={SMS_MAX}
          required
          dir="auto"
          aria-describedby="quick-sms-counter"
          className="w-full rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        />
        <p id="quick-sms-counter" className="sr-only">
          {body.length} caractères sur {SMS_MAX} maximum.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending || patients.length === 0}
        className="w-full cursor-pointer rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Envoi…" : "Envoyer le SMS"}
      </button>
    </form>
  );
}
