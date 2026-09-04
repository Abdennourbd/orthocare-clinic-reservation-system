"use client";

import { useEffect, useState, type FormEvent } from "react";

// Task 21 — settings dashboard (ADMIN): working hours, slot config, booking
// policy, messaging templates, clinic info. FR plain language throughout —
// the clinic owner uses this unaided, so labels say "Horaires d'ouverture"
// rather than `workingHours`.
//
// Each section saves independently via PATCH /api/admin/settings
// ({ key, value }). Changes take effect immediately: the slot engine, the
// expiry cron and the SMS Center read these rows live.

type DayValue = { closed: true } | { open: string; close: string };
type WorkingHours = Record<"sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri", DayValue>;

const DAYS: Array<{ id: keyof WorkingHours; label: string }> = [
  { id: "sat", label: "Samedi" },
  { id: "sun", label: "Dimanche" },
  { id: "mon", label: "Lundi" },
  { id: "tue", label: "Mardi" },
  { id: "wed", label: "Mercredi" },
  { id: "thu", label: "Jeudi" },
  { id: "fri", label: "Vendredi" },
];

const TEMPLATE_META: Array<{ key: string; label: string; hint: string }> = [
  { key: "bookingReceived", label: "Demande reçue", hint: "{firstName} {serviceName} {date} {time} {phone}" },
  { key: "confirmation", label: "Confirmation", hint: "{firstName} {serviceName} {date} {time} {selfServiceLink}" },
  { key: "cancelled", label: "Annulation", hint: "{firstName} {serviceName} {date} {time}" },
  { key: "reschedule", label: "Déplacement", hint: "{firstName} {serviceName} {oldDate} {oldTime} {newDate} {newTime} {selfServiceLink}" },
  { key: "reminder", label: "Rappel 24h", hint: "{firstName} {serviceName} {date} {time}" },
  { key: "noShow", label: "Absence", hint: "{firstName} {serviceName} {date} {time}" },
  { key: "expired", label: "Expiration", hint: "{firstName} {serviceName} {date} {time}" },
  { key: "delay", label: "Retard du jour", hint: "{firstName} {time} {delayMinutes}" },
  { key: "waitlist", label: "Place libérée", hint: "{firstName} {serviceName} {date} {time}" },
];

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

const buttonPrimaryClass =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const sectionClass = "rounded-lg border border-slate-200 bg-white p-4";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  return fallback;
}

async function patchSettings(key: string, value: unknown): Promise<string | null> {
  const response = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!response.ok) return readError(response, "Enregistrement impossible.");
  return null;
}

export default function SettingsDashboard() {
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);
  const [granularity, setGranularity] = useState("15");
  const [buffer, setBuffer] = useState("5");
  const [lunchEnabled, setLunchEnabled] = useState(false);
  const [lunchStart, setLunchStart] = useState("13:00");
  const [lunchEnd, setLunchEnd] = useState("14:00");
  const [pendingExpiry, setPendingExpiry] = useState("24");
  const [leadTime, setLeadTime] = useState("120");
  const [horizon, setHorizon] = useState("90");
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [clinicName, setClinicName] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/admin/settings");
        if (!response.ok) {
          setError("Impossible de charger les réglages.");
          return;
        }
        const body = (await response.json()) as {
          settings: {
            workingHours: WorkingHours | null;
            slotConfig: { granularityMinutes?: number; bufferMinutes?: number; lunchBreak?: { start: string; end: string } | null } | null;
            bookingPolicy: { pendingExpiryHours?: number; minLeadTimeMinutes?: number; maxHorizonDays?: number } | null;
            messageTemplates: Record<string, string>;
            clinicInfo: { name?: string; phone?: string; address?: string } | null;
          };
        };
        if (body.settings.workingHours) setWorkingHours(body.settings.workingHours);
        if (body.settings.slotConfig) {
          setGranularity(String(body.settings.slotConfig.granularityMinutes ?? 15));
          setBuffer(String(body.settings.slotConfig.bufferMinutes ?? 5));
          if (body.settings.slotConfig.lunchBreak) {
            setLunchEnabled(true);
            setLunchStart(body.settings.slotConfig.lunchBreak.start);
            setLunchEnd(body.settings.slotConfig.lunchBreak.end);
          }
        }
        if (body.settings.bookingPolicy) {
          setPendingExpiry(String(body.settings.bookingPolicy.pendingExpiryHours ?? 24));
          setLeadTime(String(body.settings.bookingPolicy.minLeadTimeMinutes ?? 120));
          setHorizon(String(body.settings.bookingPolicy.maxHorizonDays ?? 90));
        }
        setTemplates(body.settings.messageTemplates ?? {});
        if (body.settings.clinicInfo) {
          setClinicName(body.settings.clinicInfo.name ?? "");
          setClinicPhone(body.settings.clinicInfo.phone ?? "");
          setClinicAddress(body.settings.clinicInfo.address ?? "");
        }
      } catch {
        setError("Impossible de charger les réglages.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (section: string, fn: () => Promise<string | null>) => {
    setSaving(section);
    setNotice(null);
    setError(null);
    try {
      const err = await fn();
      if (err) setError(err);
      else setNotice("Réglages enregistrés.");
    } finally {
      setSaving(null);
    }
  };

  const saveHours = (e: FormEvent) => {
    e.preventDefault();
    if (!workingHours) return;
    void save("hours", () => patchSettings("workingHours", workingHours));
  };

  const saveSlots = (e: FormEvent) => {
    e.preventDefault();
    void save("slots", () =>
      patchSettings("slotConfig", {
        granularityMinutes: Number(granularity),
        bufferMinutes: Number(buffer),
        lunchBreak: lunchEnabled ? { start: lunchStart, end: lunchEnd } : null,
      }),
    );
  };

  const savePolicy = (e: FormEvent) => {
    e.preventDefault();
    void save("policy", () =>
      patchSettings("bookingPolicy", {
        pendingExpiryHours: Number(pendingExpiry),
        minLeadTimeMinutes: Number(leadTime),
        maxHorizonDays: Number(horizon),
        clinicTimezone: "Africa/Algiers",
      }),
    );
  };

  const saveTemplates = (e: FormEvent) => {
    e.preventDefault();
    // Empty fields mean "leave unchanged" — the API 400s on empty strings
    // (an empty template would silently fall back to the default anyway, so
    // rejecting surfaces the typo instead of hiding it).
    const nonEmpty = Object.fromEntries(
      Object.entries(templates).filter(([, v]) => v.trim() !== ""),
    );
    void save("templates", () => patchSettings("messageTemplates", nonEmpty));
  };

  const saveClinic = (e: FormEvent) => {
    e.preventDefault();
    void save("clinic", () =>
      patchSettings("clinicInfo", { name: clinicName, phone: clinicPhone, address: clinicAddress }),
    );
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Chargement des réglages">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Réglages</h1>
        <p className="mt-1 text-sm text-slate-600">
          Horaires, créneaux, règles de réservation, messages SMS et informations de la clinique.
        </p>
      </div>

      {notice ? (
        <div role="status" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <form onSubmit={saveHours} className={sectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Horaires d&apos;ouverture (heure d&apos;Alger)</h2>
        <p className="mt-1 text-xs text-slate-500">Samedi–jeudi 10h–17h par défaut, vendredi fermé.</p>
        <ul className="mt-3 space-y-2">
          {DAYS.map((d) =>
            workingHours ? (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 font-medium text-slate-700">{d.label}</span>
                {"closed" in workingHours[d.id] ? (
                  <>
                    <span className="text-xs text-slate-500">Fermé</span>
                    <button
                      type="button"
                      className="text-xs text-teal-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      onClick={() =>
                        setWorkingHours({ ...workingHours, [d.id]: { open: "10:00", close: "17:00" } })
                      }
                    >
                      Ouvrir
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      aria-label={`${d.label} ouverture`}
                      type="time"
                      className={inputClass}
                      value={(workingHours[d.id] as { open: string }).open}
                      onChange={(e) =>
                        setWorkingHours({
                          ...workingHours,
                          [d.id]: { open: e.target.value, close: (workingHours[d.id] as { close: string }).close },
                        })
                      }
                    />
                    <span className="text-slate-500">–</span>
                    <input
                      aria-label={`${d.label} fermeture`}
                      type="time"
                      className={inputClass}
                      value={(workingHours[d.id] as { close: string }).close}
                      onChange={(e) =>
                        setWorkingHours({
                          ...workingHours,
                          [d.id]: { open: (workingHours[d.id] as { open: string }).open, close: e.target.value },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-xs text-slate-500 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                      onClick={() => setWorkingHours({ ...workingHours, [d.id]: { closed: true } })}
                    >
                      Fermer
                    </button>
                  </>
                )}
              </li>
            ) : null,
          )}
        </ul>
        <div className="mt-3">
          <button type="submit" className={buttonPrimaryClass} disabled={saving === "hours" || !workingHours}>
            {saving === "hours" ? "Enregistrement…" : "Enregistrer les horaires"}
          </button>
        </div>
      </form>

      <form onSubmit={saveSlots} className={sectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Créneaux et pauses</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Pas de la grille (minutes, multiple de 5)
            <input aria-label="Pas de la grille" className={inputClass} value={granularity} onChange={(e) => setGranularity(e.target.value)} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Battement entre rendez-vous (minutes)
            <input aria-label="Battement" className={inputClass} value={buffer} onChange={(e) => setBuffer(e.target.value)} inputMode="numeric" required />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={lunchEnabled} onChange={(e) => setLunchEnabled(e.target.checked)} className="h-4 w-4 accent-teal-700" />
          Pause déjeuner (aucun créneau pendant la pause)
        </label>
        {lunchEnabled ? (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input aria-label="Début de la pause" type="time" className={inputClass} value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} />
            <span className="text-slate-500">–</span>
            <input aria-label="Fin de la pause" type="time" className={inputClass} value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} />
          </div>
        ) : null}
        <div className="mt-3">
          <button type="submit" className={buttonPrimaryClass} disabled={saving === "slots"}>
            {saving === "slots" ? "Enregistrement…" : "Enregistrer les créneaux"}
          </button>
        </div>
      </form>

      <form onSubmit={savePolicy} className={sectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Règles de réservation</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Expiration des demandes (heures)
            <input aria-label="Expiration" className={inputClass} value={pendingExpiry} onChange={(e) => setPendingExpiry(e.target.value)} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Délai minimum avant un créneau (minutes)
            <input aria-label="Délai minimum" className={inputClass} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} inputMode="numeric" required />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Horizon maximum (jours)
            <input aria-label="Horizon" className={inputClass} value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" required />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Fuseau : Africa/Algiers (fixe). L&apos;expiration s&apos;applique aussi avant le début du rendez-vous.</p>
        <div className="mt-3">
          <button type="submit" className={buttonPrimaryClass} disabled={saving === "policy"}>
            {saving === "policy" ? "Enregistrement…" : "Enregistrer les règles"}
          </button>
        </div>
      </form>

      <form onSubmit={saveTemplates} className={sectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Modèles de SMS</h2>
        <p className="mt-1 text-xs text-slate-500">Utilisés par le centre SMS et les envois automatiques. Les codes entre accolades sont remplacés automatiquement.</p>
        <div className="mt-3 space-y-3">
          {TEMPLATE_META.map((t) => (
            <label key={t.key} className="flex flex-col gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-900">{t.label} <span className="font-normal text-slate-500">· {t.hint}</span></span>
              <textarea
                aria-label={t.label}
                className={inputClass}
                value={templates[t.key] ?? ""}
                onChange={(e) => setTemplates({ ...templates, [t.key]: e.target.value })}
                rows={2}
              />
            </label>
          ))}
        </div>
        <div className="mt-3">
          <button type="submit" className={buttonPrimaryClass} disabled={saving === "templates"}>
            {saving === "templates" ? "Enregistrement…" : "Enregistrer les modèles"}
          </button>
        </div>
      </form>

      <form onSubmit={saveClinic} className={sectionClass}>
        <h2 className="text-sm font-semibold text-slate-900">Informations de la clinique</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Nom
            <input aria-label="Nom de la clinique" className={inputClass} value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Téléphone
            <input aria-label="Téléphone de la clinique" className={inputClass} value={clinicPhone} onChange={(e) => setClinicPhone(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
            Adresse
            <input aria-label="Adresse de la clinique" className={inputClass} value={clinicAddress} onChange={(e) => setClinicAddress(e.target.value)} />
          </label>
        </div>
        <div className="mt-3">
          <button type="submit" className={buttonPrimaryClass} disabled={saving === "clinic"}>
            {saving === "clinic" ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
