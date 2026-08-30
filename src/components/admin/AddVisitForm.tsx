"use client";

import { useEffect, useState, type FormEvent } from "react";
import { visitCreateSchema, visitTypeValues, type VisitCreateInput } from "@/schemas/patient";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 13 step 8 — manual visit entry, aligned exactly on `visitCreateSchema`
// (@/schemas/patient, imported — never redefined) and posted to
// POST /api/admin/patients/[id]/visits. On success the parent
// (PatientDetail) bumps the timeline's reload token — no page reload, per
// the acceptance criterion ("sans rechargement complet de la page").
//
// The service selector is deliberately optional (visitCreateSchema.serviceId
// is `.optional()`): a manual visit may record care given before this system
// existed, or a walk-in that never matched a catalogue service
// (prisma/schema.prisma comment on `model Visit`). Its options come from the
// PUBLIC `GET /api/services` endpoint (src/app/api/services/route.ts) — a
// read-only, unauthenticated, no-patient-data listing already used by the
// booking wizard; reusing it here avoids adding a second admin-only services
// route for what is, from this form's point of view, exactly the same
// catalogue lookup.
//
// `notes`/`treatment` are free-text CLINICAL content — `dir="auto"` so a
// note written in Arabic script renders correctly inside this LTR dashboard
// (task-13.md étape 8 spec), and neither is ever sent to `logAction()` (see
// the route's own header comment).

interface ServiceOption {
  id: string;
  name: string;
}

const VISIT_TYPE_LABEL: Record<(typeof visitTypeValues)[number], string> = {
  CONSULTATION: "Consultation",
  TRAITEMENT: "Traitement",
  CONTROLE: "Contrôle",
  URGENCE: "Urgence",
  AUTRE: "Autre",
};

interface FormValues {
  date: string;
  serviceId: string;
  type: (typeof visitTypeValues)[number];
  notes: string;
  treatment: string;
}

function todayLocalDate(): string {
  // Correction étape 8 (audit ortho-reviewer, point 5) — this used to be
  // `new Date().toISOString().slice(0, 10)`, which is the UTC calendar
  // date, not the clinic's: between 00h00 and 01h00 in Africa/Algiers
  // (UTC+1), that returned YESTERDAY's date as the default. `plan.md
  // §Timezone` designates `@/lib/time/clinicTime` as the only module
  // allowed to know the clinic's timezone — reused here rather than
  // hard-coding it again, same as PatientTimeline/PatientDetail already do.
  return toClinicLocalDateString(new Date());
}

const EMPTY_VALUES: FormValues = {
  date: todayLocalDate(),
  serviceId: "",
  type: "CONSULTATION",
  notes: "",
  treatment: "",
};

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const labelClass = "block text-sm font-medium text-slate-700";
const errorTextClass = "text-xs text-red-700";

export default function AddVisitForm({
  patientId,
  onCreated,
}: {
  patientId: string;
  onCreated: () => void;
}) {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/services?locale=fr");
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { services: ServiceOption[] };
        if (!cancelled) setServices(body.services);
      } catch {
        // The service selector is optional — a failed lookup just leaves it
        // empty, it never blocks recording a visit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const candidate: VisitCreateInput = {
      date: values.date,
      serviceId: values.serviceId ? values.serviceId : undefined,
      type: values.type,
      notes: values.notes ? values.notes : undefined,
      treatment: values.treatment ? values.treatment : undefined,
    };

    const parsed = visitCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      const nextFieldErrors: Partial<Record<keyof FormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in EMPTY_VALUES) {
          nextFieldErrors[key as keyof FormValues] = issue.message;
        }
      }
      setFieldErrors(nextFieldErrors);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setPending(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/admin/patients/${patientId}/visits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (response.ok) {
        setValues(EMPTY_VALUES);
        onCreated();
        return;
      }

      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        setFormError("Trop de requêtes. Réessayez plus tard.");
        return;
      }

      setFormError(
        (body?.error?.message as string | undefined) ?? "Une erreur est survenue. Réessayez.",
      );
    } catch {
      setFormError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Ajouter une visite</h3>

      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <form className="space-y-3" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="visit-date" className={labelClass}>
              Date
            </label>
            <input
              id="visit-date"
              type="date"
              value={values.date}
              onChange={(e) => handleChange("date", e.target.value)}
              aria-describedby={fieldErrors.date ? "visit-date-error" : undefined}
              aria-invalid={Boolean(fieldErrors.date)}
              className={inputClass}
            />
            {fieldErrors.date && (
              <p id="visit-date-error" className={errorTextClass}>
                {fieldErrors.date}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="visit-type" className={labelClass}>
              Type
            </label>
            <select
              id="visit-type"
              value={values.type}
              onChange={(e) => handleChange("type", e.target.value as FormValues["type"])}
              className={inputClass}
            >
              {visitTypeValues.map((type) => (
                <option key={type} value={type}>
                  {VISIT_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="visit-service" className={labelClass}>
              Service (facultatif)
            </label>
            <select
              id="visit-service"
              value={values.serviceId}
              onChange={(e) => handleChange("serviceId", e.target.value)}
              className={inputClass}
            >
              <option value="">Aucun service précis</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="visit-treatment" className={labelClass}>
            Traitement (facultatif)
          </label>
          <textarea
            id="visit-treatment"
            value={values.treatment}
            onChange={(e) => handleChange("treatment", e.target.value)}
            dir="auto"
            rows={2}
            aria-describedby={fieldErrors.treatment ? "visit-treatment-error" : undefined}
            aria-invalid={Boolean(fieldErrors.treatment)}
            className={inputClass}
          />
          {fieldErrors.treatment && (
            <p id="visit-treatment-error" className={errorTextClass}>
              {fieldErrors.treatment}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="visit-notes" className={labelClass}>
            Notes (facultatives)
          </label>
          <textarea
            id="visit-notes"
            value={values.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            dir="auto"
            rows={2}
            aria-describedby={fieldErrors.notes ? "visit-notes-error" : undefined}
            aria-invalid={Boolean(fieldErrors.notes)}
            className={inputClass}
          />
          {fieldErrors.notes && (
            <p id="visit-notes-error" className={errorTextClass}>
              {fieldErrors.notes}
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
          {pending ? "Enregistrement…" : "Ajouter la visite"}
        </button>
      </form>
    </div>
  );
}
