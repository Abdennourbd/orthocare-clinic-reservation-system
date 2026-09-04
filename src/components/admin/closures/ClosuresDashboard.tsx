"use client";

import { useEffect, useState, type FormEvent } from "react";
import ConfirmPanel from "@/components/admin/ConfirmPanel";
import { CLINIC_TIMEZONE } from "@/lib/time/clinicTime";

// Task 21 — closures dashboard (ADMIN): holidays, Eid, vacation, emergency
// closures. Creating a closure blocks new bookings immediately and returns
// the overlapping appointments — staff decide per closure (bulk
// cancel-and-notify or keep-for-call). Appointments are never dropped
// silently: the resolve step is explicit.

type Closure = {
  id: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: Record<string, string>;
  serviceId: string | null;
  createdAt: string;
  service?: { id: string; slug: string; name: unknown } | null;
};

type Affected = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  service: { id: string; slug: string; name: unknown };
  patient: { id: string; firstName: string; lastName: string; phoneE164: string };
};

type Service = { id: string; slug: string; name: Record<string, string> };

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

const buttonDangerClass =
  "rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 " +
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

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TIMEZONE });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: CLINIC_TIMEZONE });
}

export default function ClosuresDashboard() {
  const [closures, setClosures] = useState<Closure[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("13:00");
  const [endTime, setEndTime] = useState("14:00");
  const [reason, setReason] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [creating, setCreating] = useState(false);

  const [lastCreated, setLastCreated] = useState<Closure | null>(null);
  const [affected, setAffected] = useState<Affected[]>([]);
  const [resolving, setResolving] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Inline two-step confirm (never window.confirm): the bulk cancel+SMS is
  // the highest-impact action in the app and must stay keyboard/screen-reader
  // navigable. The 409-stale-list case becomes a second confirm step with the
  // server's own message instead of a blocking dialog.
  const [confirm, setConfirm] = useState<
    | { kind: "cancel_and_notify"; closureId: string; ids: string[] }
    | { kind: "continue409"; closureId: string; ids: string[]; message: string }
    | { kind: "remove"; closure: Closure }
    | null
  >(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cRes, sRes] = await Promise.all([fetch("/api/admin/closures"), fetch("/api/admin/services")]);
      if (cRes.ok) {
        const body = (await cRes.json()) as { closures: Closure[] };
        setClosures(body.closures);
      } else {
        setClosures([]);
        setLoadError("Impossible de charger les fermetures.");
      }
      if (sRes.ok) {
        const body = (await sRes.json()) as { services: Service[] };
        setServices(body.services);
      }
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
      try {
        const [cRes, sRes] = await Promise.all([fetch("/api/admin/closures"), fetch("/api/admin/services")]);
        if (cancelled) return;
        if (cRes.ok) {
          const body = (await cRes.json()) as { closures: Closure[] };
          if (!cancelled) {
            setClosures(body.closures);
            setLoadError(null);
          }
        } else if (!cancelled) {
          setClosures([]);
          setLoadError("Impossible de charger les fermetures.");
        }
        if (sRes.ok && !cancelled) {
          const body = (await sRes.json()) as { services: Service[] };
          setServices(body.services);
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
    setLastCreated(null);
    setAffected([]);
    try {
      const response = await fetch("/api/admin/closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate: endDate || startDate,
          allDay,
          ...(allDay ? {} : { startTime, endTime }),
          reason: { fr: reason.trim() },
          ...(serviceId ? { serviceId } : {}),
        }),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Création impossible."));
        return;
      }
      const body = (await response.json()) as { closure: Closure; affectedCount: number; affected: Affected[] };
      setLastCreated(body.closure);
      setAffected(body.affected);
      setNotice(
        body.affectedCount === 0
          ? "Fermeture enregistrée. Aucun rendez-vous concerné."
          : `Fermeture enregistrée. ${body.affectedCount} rendez-vous à traiter ci-dessous.`,
      );
      setStartDate("");
      setEndDate("");
      setReason("");
      setServiceId("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const resolve = async (action: "cancel_and_notify" | "keep_for_call", closureId: string, ids: string[], acknowledgedUnresolved = false) => {
    setResolving(true);
    setConfirmError(null);
    try {
      const send = (ack: boolean) =>
        fetch(`/api/admin/closures/${closureId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, appointmentIds: ids, acknowledgedUnresolved: ack }),
        });
      // First attempt WITHOUT the escape hatch: if the affected list went
      // stale (a booking landed or left since the preview), the API answers
      // 409 UNRESOLVED_REMAINING and staff confirm explicitly rather than
      // silently resolving a subset.
      let response = await send(acknowledgedUnresolved);
      if (response.status === 409 && !acknowledgedUnresolved) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        if (body?.error?.code === "UNRESOLVED_REMAINING") {
          setConfirm({
            kind: "continue409",
            closureId,
            ids,
            message: `${body.error.message ?? "Des rendez-vous restent sans décision."} Continuer quand même ?`,
          });
          return;
        }
      }
      if (!response.ok) {
        setConfirmError(await readError(response, "Traitement impossible."));
        return;
      }
      const body = (await response.json()) as { succeeded?: string[]; failed?: Array<{ id: string }> };
      if (action === "cancel_and_notify") {
        setNotice(`${(body.succeeded ?? []).length} rendez-vous annulés et patients prévenus.${(body.failed ?? []).length > 0 ? ` ${(body.failed ?? []).length} échecs.` : ""}`);
      } else {
        setNotice("Rendez-vous conservés pour rappel téléphonique.");
      }
      setAffected([]);
      setLastCreated(null);
      setConfirm(null);
    } finally {
      setResolving(false);
    }
  };

  const remove = async (c: Closure) => {
    setRowBusy(c.id);
    setConfirmError(null);
    try {
      const response = await fetch(`/api/admin/closures/${c.id}`, { method: "DELETE" });
      if (!response.ok) {
        setConfirmError(await readError(response, "Suppression impossible."));
        return;
      }
      setNotice("Fermeture supprimée.");
      setConfirm(null);
      await load();
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Chargement des fermetures">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Fermetures</h1>
        <p className="mt-1 text-sm text-slate-600">
          Jours fériés, Aïd, vacances, fermetures exceptionnelles. Une fermeture bloque aussitôt les nouvelles réservations.
        </p>
      </div>

      {notice ? (
        <div role="status" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          {notice}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {loadError}{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Réessayer
          </button>
        </div>
      ) : null}

      <form onSubmit={create} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Nouvelle fermeture</h2>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Premier jour
          <input aria-label="Premier jour" type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Dernier jour (vide = un seul jour)
          <input aria-label="Dernier jour" type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-teal-700" />
          Journée entière
        </label>
        {!allDay ? (
          <div className="flex items-center gap-2 text-sm sm:col-span-2">
            <input aria-label="Début" type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <span className="text-slate-500">–</span>
            <input aria-label="Fin" type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Motif (visible par les patients : « fermé »)
          <input aria-label="Motif" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex. Aïd el-Fitr" required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Service concerné (vide = toute la clinique)
          <select aria-label="Service concerné" className={inputClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Toute la clinique</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.slug}
              </option>
            ))}
          </select>
        </label>
        {formError ? (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {formError}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button type="submit" className={buttonPrimaryClass} disabled={creating}>
            {creating ? "Enregistrement…" : "Enregistrer la fermeture"}
          </button>
        </div>
      </form>

      {lastCreated && affected.length > 0 ? (
        <section aria-label="Rendez-vous concernés" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {affected.length} rendez-vous pendant cette fermeture — que faire ?
          </h2>
          <ul className="mt-3 space-y-2">
            {affected.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-white p-2 text-sm">
                <span className="font-medium text-slate-900">
                  {a.patient.firstName} {a.patient.lastName}
                </span>
                <span className="text-slate-600">
                  {formatDay(a.startTime)} à {formatTime(a.startTime)} · {a.service.slug} · {a.status}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonDangerClass}
              disabled={resolving}
              onClick={() =>
                setConfirm({
                  kind: "cancel_and_notify",
                  closureId: lastCreated.id,
                  ids: affected.map((a) => a.id),
                })
              }
            >
              Tout annuler et prévenir par SMS
            </button>
            <button
              type="button"
              className={buttonSecondaryClass}
              disabled={resolving}
              onClick={() => void resolve("keep_for_call", lastCreated.id, affected.map((a) => a.id))}
            >
              Garder pour rappel téléphonique
            </button>
          </div>
          {confirm?.kind === "cancel_and_notify" ? (
            <div className="mt-3">
              <ConfirmPanel
                message={`Annuler ${confirm.ids.length} rendez-vous et prévenir chaque patient par SMS ?`}
                confirmLabel="Oui, tout annuler et prévenir"
                pendingLabel="Envoi…"
                pending={resolving}
                error={confirmError}
                onConfirm={() => void resolve("cancel_and_notify", confirm.closureId, confirm.ids)}
                onCancel={() => {
                  setConfirm(null);
                  setConfirmError(null);
                }}
              />
            </div>
          ) : null}
          {confirm?.kind === "continue409" ? (
            <div className="mt-3">
              <ConfirmPanel
                message={confirm.message}
                confirmLabel="Continuer quand même"
                pendingLabel="Envoi…"
                pending={resolving}
                error={confirmError}
                onConfirm={() => void resolve("cancel_and_notify", confirm.closureId, confirm.ids, true)}
                onCancel={() => {
                  setConfirm(null);
                  setConfirmError(null);
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Fermetures enregistrées">
        <h2 className="text-sm font-semibold text-slate-900">Fermetures enregistrées</h2>
        {!loadError && (closures ?? []).length === 0 ? (
          <div role="status" className="mt-2 rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            Aucune fermeture enregistrée.
          </div>
        ) : null}
        <ul className="mt-2 space-y-2">
          {(closures ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {formatDay(c.startDate.toString())}
                  {new Date(c.startDate).toDateString() !== new Date(c.endDate).toDateString()
                    ? ` → ${formatDay(c.endDate.toString())}`
                    : ""}
                  {" · "}
                  {c.allDay ? "journée entière" : `${c.startTime}–${c.endTime}`}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {fr(c.reason)}{c.service ? ` · ${c.service.slug}` : " · toute la clinique"}
                </p>
              </div>
              <button type="button" className={buttonSecondaryClass} disabled={rowBusy === c.id} onClick={() => setConfirm({ kind: "remove", closure: c })}>
                Supprimer
              </button>
              {confirm?.kind === "remove" && confirm.closure.id === c.id ? (
                <div className="mt-2 w-full">
                  <ConfirmPanel
                    message="Supprimer cette fermeture ? Les créneaux rouvrent aussitôt."
                    confirmLabel="Oui, supprimer"
                    pendingLabel="Suppression…"
                    pending={rowBusy === c.id}
                    error={confirmError}
                    onConfirm={() => void remove(confirm.closure)}
                    onCancel={() => {
                      setConfirm(null);
                      setConfirmError(null);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
