"use client";

import { useEffect, useState, type FormEvent } from "react";
import { manualBookingSchema } from "@/schemas/appointment";
import { clinicLocalToUTC, toClinicLocalDateString } from "@/lib/time/clinicTime";
import type { AppointmentRow } from "./appointmentTypes";

// Task 14 step 5 — manual booking (POST /api/admin/appointments): pick an
// EXISTING active patient (submit-only search against GET /api/admin/patients,
// same submit-only rationale as PatientList — one shared rate-limit pool),
// a service (GET /api/services), a clinic-local date + time, an optional
// note. The picked wall-clock time is converted to the UTC instant by
// clinicLocalToUTC (lib/time/clinicTime.ts — the only tz-aware module).
// Client-side validation uses the SHARED manualBookingSchema, never a
// re-declared copy. A 409 SLOT_CONFLICT is shown inline.

interface PatientHit {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  anonymizedAt: string | null;
}

interface ServiceHit {
  id: string;
  name: string;
  durationMinutes: number;
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const labelClass = "block text-sm font-medium text-slate-700";
const errorTextClass = "text-xs text-red-700";
const buttonPrimary =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const buttonNeutral =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 " +
  "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export default function ManualBookingForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (appointment: AppointmentRow) => void;
  onCancel?: () => void;
}) {
  // Patient step
  const [patientQuery, setPatientQuery] = useState("");
  const [patientHits, setPatientHits] = useState<PatientHit[] | null>(null);
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null);

  // Reference data
  const [services, setServices] = useState<ServiceHit[]>([]);
  const [servicesError, setServicesError] = useState(false);

  // Slot + extras
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(() => toClinicLocalDateString(new Date()));
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [locale, setLocale] = useState<"" | "fr" | "ar" | "en">("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/services?locale=fr");
        if (cancelled) return;
        if (!response.ok) {
          setServicesError(true);
          return;
        }
        const body = (await response.json()) as { services: ServiceHit[] };
        if (cancelled) return;
        setServices(body.services);
      } catch {
        if (!cancelled) setServicesError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function searchPatients() {
    const q = patientQuery.trim();
    if (!q) return;
    setPatientSearching(true);
    setPatientSearchError(false);
    try {
      const response = await fetch(`/api/admin/patients?q=${encodeURIComponent(q)}`);
      if (!response.ok) {
        setPatientSearchError(true);
        return;
      }
      const body = (await response.json()) as { patients: PatientHit[] };
      setPatientHits(body.patients.filter((p) => p.active && !p.anonymizedAt));
    } catch {
      setPatientSearchError(true);
    } finally {
      setPatientSearching(false);
    }
  }

  async function submitBooking() {
    if (!selectedPatient) return;
    const startUTC = clinicLocalToUTC(date, time);
    const candidate = {
      patientId: selectedPatient.id,
      serviceId,
      startTime: startUTC ? startUTC.toISOString() : "",
      ...(notes.trim() ? { notes: notes } : {}),
      ...(locale ? { locale } : {}),
    };
    const parsed = manualBookingSchema.safeParse(candidate);
    if (!parsed.success || !startUTC) {
      const nextErrors: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (typeof key === "string") nextErrors[key] = issue.message;
        }
      }
      if (!startUTC) nextErrors.startTime = "Date/heure de début invalide.";
      setFieldErrors(nextErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        onSuccess(body as AppointmentRow);
        return;
      }
      if (response.status === 409) {
        setFormError(body?.error?.message ?? "Ce créneau n'est pas disponible. Choisissez un autre horaire.");
        return;
      }
      if (response.status === 429) {
        setFormError("Trop de requêtes. Réessayez plus tard.");
        return;
      }
      setFormError(body?.error?.message ?? "Une erreur est survenue. Réessayez.");
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitBooking();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Nouveau rendez-vous</h2>

      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <div className="space-y-2">
            <span className={labelClass}>Patient (dossier existant actif)</span>
            {selectedPatient ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">
                  {selectedPatient.lastName} {selectedPatient.firstName}
                </span>
                <span className="text-slate-600" dir="auto">
                  {selectedPatient.phone}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPatient(null);
                    setPatientHits(null);
                    setPatientQuery("");
                  }}
                  className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700
                    hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                >
                  Changer
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label htmlFor="booking-patient-q" className="block text-xs font-medium text-slate-600">
                      Rechercher (nom ou téléphone)
                    </label>
                    <input
                      id="booking-patient-q"
                      value={patientQuery}
                      onChange={(e) => setPatientQuery(e.target.value)}
                      dir="auto"
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void searchPatients()}
                    disabled={patientSearching || !patientQuery.trim()}
                    className={buttonNeutral}
                  >
                    {patientSearching ? "Recherche…" : "Rechercher"}
                  </button>
                </div>
                {patientSearchError && (
                  <p role="alert" className={errorTextClass}>
                    Recherche impossible. Réessayez.
                  </p>
                )}
                {patientHits && patientHits.length === 0 && (
                  <p className={errorTextClass} role="status">
                    Aucun patient actif trouvé. Créez d&rsquo;abord le dossier dans « Patients ».
                  </p>
                )}
                {patientHits && patientHits.length > 0 && (
                  <ul className="space-y-1">
                    {patientHits.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatient(p);
                            setPatientHits(null);
                          }}
                          className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm
                            text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                        >
                          <span className="font-medium">
                            {p.lastName} {p.firstName}
                          </span>{" "}
                          <span className="text-slate-600" dir="auto">
                            {p.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {fieldErrors.patientId && <p className={errorTextClass}>{fieldErrors.patientId}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="booking-service" className={labelClass}>
                Service
              </label>
              {servicesError ? (
                <p role="alert" className={errorTextClass}>
                  Impossible de charger les services. Actualisez la page.
                </p>
              ) : (
                <select
                  id="booking-service"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  className={inputClass}
                  aria-invalid={Boolean(fieldErrors.serviceId)}
                  aria-describedby={fieldErrors.serviceId ? "booking-service-error" : undefined}
                >
                  <option value="">— Choisir un service —</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.durationMinutes} min)
                    </option>
                  ))}
                </select>
              )}
              {fieldErrors.serviceId && (
                <p id="booking-service-error" className={errorTextClass}>
                  {fieldErrors.serviceId}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="booking-date" className={labelClass}>
                  Date (heure du cabinet)
                </label>
                <input
                  id="booking-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="booking-time" className={labelClass}>
                  Heure
                </label>
                <input
                  id="booking-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClass}
                  aria-invalid={Boolean(fieldErrors.startTime)}
                  aria-describedby={fieldErrors.startTime ? "booking-time-error" : undefined}
                />
                {fieldErrors.startTime && (
                  <p id="booking-time-error" className={errorTextClass}>
                    {fieldErrors.startTime}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="booking-notes" className={labelClass}>
              Note (facultative)
            </label>
            <textarea
              id="booking-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              dir="auto"
              className={inputClass}
              aria-describedby={fieldErrors.notes ? "booking-notes-error" : undefined}
            />
            {fieldErrors.notes && (
              <p id="booking-notes-error" className={errorTextClass}>
                {fieldErrors.notes}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="booking-locale" className={labelClass}>
              Langue pour les messages (facultative)
            </label>
            <select
              id="booking-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
              className={inputClass}
            >
              <option value="">Ne pas modifier la langue du patient</option>
              <option value="fr">Français</option>
              <option value="ar">Arabe</option>
              <option value="en">Anglais</option>
            </select>
          </div>
        </fieldset>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending || !selectedPatient}
            className={buttonPrimary}
          >
            {pending ? "Création…" : "Créer le rendez-vous"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={pending} className={buttonNeutral}>
              Annuler
            </button>
          )}
        </div>
      </form>

      {date && time && clinicLocalToUTC(date, time) && (
        <p className="text-xs text-slate-500">
          Créneau : le {date.split("-").reverse().join("/")} à {time} (heure du cabinet).
        </p>
      )}
    </div>
  );
}
