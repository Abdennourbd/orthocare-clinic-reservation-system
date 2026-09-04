"use client";

import { useEffect, useState, type FormEvent } from "react";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { toClinicLocalDateString, addClinicDays } from "@/lib/time/clinicTime";
import PatientPicker, { type PatientHit } from "./PatientPicker";

// Task 17.3 — front-desk (STAFF-source) waitlist create
// (POST /api/admin/waitlist): pick an EXISTING active patient via a
// SUBMIT-ONLY search against GET /api/admin/patients?q=…, one service, and
// 1-10 clinic-local watched dates.
//
// Submit-only is the same deliberate ruling as ManualSmsForm: every
// patients-list GET is an audited PATIENT_RECORD_VIEWED and a draw from the
// shared `staff:<userId>:patients-read` pool — never a per-keystroke fetch.
//
// Date bounds are client-side UX only (the server re-validates against the
// live booking policy): min is the clinic's today, max the +90d horizon
// default. Past dates are refused with a French message before any network
// call. Nothing patient-identifying is logged to the console.

export interface WaitlistServiceOption {
  id: string;
  name: string;
}

const MAX_DATES = 10;
const HORIZON_DAYS = 90;

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

function optionLabel(name: unknown): string {
  if (typeof name === "string") return name;
  return localized(name as LocalizedField, "fr");
}

export default function WaitlistForm({
  services: servicesProp,
  onCreated,
}: {
  services?: WaitlistServiceOption[];
  onCreated?: () => void;
}) {
  // Patient search UI lives in the shared PatientPicker.
  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null);

  const [fetchedServices, setFetchedServices] = useState<WaitlistServiceOption[]>([]);
  // Services arrive as props from the dashboard container (one fetch for the
  // filter + the form); standalone mounts fall back to the fetched list.
  const services = servicesProp ?? fetchedServices;
  const [serviceId, setServiceId] = useState("");

  const [dateInput, setDateInput] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const today = toClinicLocalDateString(new Date());
  const maxDate = addClinicDays(today, HORIZON_DAYS);

  useEffect(() => {
    if (servicesProp !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/services?locale=fr");
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as {
          services: Array<{ id: string; name: unknown }>;
        };
        if (cancelled) return;
        setFetchedServices(body.services.map((s) => ({ id: s.id, name: optionLabel(s.name) })));
      } catch {
        if (!cancelled) setFetchedServices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [servicesProp]);



  function handleAddDate() {
    const value = dateInput;
    if (!value) return;
    if (dates.includes(value)) {
      setDateError("Cette date est déjà ajoutée.");
      return;
    }
    if (value < today) {
      setDateError("Cette date est dans le passé.");
      return;
    }
    if (value > maxDate) {
      setDateError("Cette date dépasse l'horizon de réservation (90 jours).");
      return;
    }
    if (dates.length >= MAX_DATES) {
      setDateError("Dix dates au maximum.");
      return;
    }
    setDateError(null);
    setDates((prev) => [...prev, value].sort());
    setDateInput("");
  }

  function resetForm() {
    setSelectedPatient(null);
    setServiceId("");
    setDateInput("");
    setDates([]);
    setDateError(null);
    setValidationErrors([]);
  }

  async function submitEntry() {
    if (!selectedPatient) return;
    setPending(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          serviceId,
          preferredDates: dates,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setFormError(data?.error?.message ?? "Une erreur est survenue. Réessayez.");
        return;
      }
      const label = `${selectedPatient.firstName} ${selectedPatient.lastName}`;
      resetForm();
      setSuccessMessage(`${label} ajouté à la liste d'attente.`);
      onCreated?.();
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // JS guard first: never a network call for a request we already know is
    // invalid (same convention as ManualSmsForm).
    const errors: string[] = [];
    if (!selectedPatient) errors.push("Sélectionnez un patient.");
    if (!serviceId) errors.push("Le service est requis.");
    if (dates.length === 0) errors.push("Au moins une date est requise.");
    setValidationErrors(errors);
    if (errors.length > 0) return;
    void submitEntry();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Ajouter à la liste d&rsquo;attente</h2>

      {successMessage && (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {successMessage}
        </p>
      )}
      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <PatientPicker
        idPrefix="waitlist"
        legend="Patient"
        selected={selectedPatient}
        onSelect={setSelectedPatient}
        fieldError={
          validationErrors.includes("Sélectionnez un patient.")
            ? "Sélectionnez un patient."
            : null
        }
      />

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <div className="space-y-1">
            <label htmlFor="waitlist-service" className={labelClass}>
              Service
            </label>
            <select
              id="waitlist-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputClass}
            >
              <option value="">Choisir un service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {validationErrors.includes("Le service est requis.") && (
              <p className={errorTextClass}>Le service est requis.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor="waitlist-date" className={labelClass}>
                  Date à surveiller
                </label>
                <input
                  id="waitlist-date"
                  type="date"
                  value={dateInput}
                  min={today}
                  max={maxDate}
                  onChange={(e) => {
                    setDateInput(e.target.value);
                    setDateError(null);
                  }}
                  className={inputClass}
                />
              </div>
              <button type="button" onClick={handleAddDate} className={buttonNeutral}>
                Ajouter la date
              </button>
            </div>
            {dateError && <p className={errorTextClass}>{dateError}</p>}
            {dates.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Dates surveillées sélectionnées">
                {dates.map((d) => (
                  <li
                    key={d}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-800"
                  >
                    <span>{d.split("-").reverse().join("/")}</span>
                    <button
                      type="button"
                      onClick={() => setDates((prev) => prev.filter((x) => x !== d))}
                      aria-label={`Retirer la date du ${d.split("-").reverse().join("/")}`}
                      className="rounded-sm px-1 text-xs font-medium text-slate-600 hover:text-slate-900
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600
                        focus-visible:ring-offset-2"
                    >
                      Retirer
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">
              {dates.length} / {MAX_DATES} dates — entre aujourd&rsquo;hui et le {maxDate.split("-").reverse().join("/")}.
            </p>
            {validationErrors.includes("Au moins une date est requise.") && (
              <p className={errorTextClass}>Au moins une date est requise.</p>
            )}
          </div>
        </fieldset>

        <div className="pt-2">
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? "Ajout…" : "Ajouter à la liste d'attente"}
          </button>
        </div>
      </form>
    </div>
  );
}
