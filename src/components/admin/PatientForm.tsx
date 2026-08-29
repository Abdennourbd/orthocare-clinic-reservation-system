"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { patientCreateSchema, type PatientCreateInput } from "@/schemas/patient";
import DuplicateWarning, { type DuplicateWarningState } from "./DuplicateWarning";

// Task 13 step 7 — patient creation form. Validation is done client-side with
// `patientCreateSchema` imported from `@/schemas/patient` — never redefined
// here (tasks/todo.md acceptance criterion for step 3: the schema is
// duplicated nowhere, and this is the first form able to prove it).
//
// Reused as-is for editing in step 8 (task-13.md étape 7 spec): the fields,
// the duplicate-acknowledgement flow and DuplicateWarning are all shared —
// only the submit URL/method and the initial values differ, which is why
// both are props rather than hard-coded.
//
// Field-level result of the duplicate check is a boolean PER GATE
// (`duplicateAcknowledged` / `phoneSharingAcknowledged`), matching the API
// contract byte-for-byte (src/schemas/patient.ts) — it is not tied to a
// specific candidate id. Editing the name or the phone after a warning was
// shown resets both acknowledgements and clears the banner: the warning
// concerned the PREVIOUS values, and silently keeping a stale "yes, save
// anyway" across an edited name/phone would be exactly the kind of gate a
// receptionist could trip through without meaning to (task-13.md
// §Décisions d'architecture 1, and the two-gate split of étape 4 tour 2).

type DuplicateFieldName = "firstName" | "lastName" | "phone";

interface FormValues {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
  notes: string;
  messagingOptOut: boolean;
  whatsappOptIn: boolean;
  preferredLocale: "" | "fr" | "ar" | "en";
}

const EMPTY_VALUES: FormValues = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  birthDate: "",
  notes: "",
  messagingOptOut: false,
  whatsappOptIn: false,
  preferredLocale: "",
};

export interface PatientFormSuccess {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  anonymizedAt: string | null;
  createdAt: string;
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const errorTextClass = "text-xs text-red-700";
const labelClass = "block text-sm font-medium text-slate-700";

export default function PatientForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (patient: PatientFormSuccess) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarningState | null>(null);
  const [ackName, setAckName] = useState(false);
  const [ackPhone, setAckPhone] = useState(false);
  const [pending, setPending] = useState(false);

  function handleDuplicateFieldChange(field: DuplicateFieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // The previous warning (if any) described the OLD name/phone — see the
    // header comment. It no longer applies to what is on screen now.
    if (duplicateWarning) setDuplicateWarning(null);
    setAckName(false);
    setAckPhone(false);
  }

  function handleChange<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(overrides?: { ackName?: boolean; ackPhone?: boolean }) {
    const nextAckName = overrides?.ackName ?? ackName;
    const nextAckPhone = overrides?.ackPhone ?? ackPhone;

    const candidate: PatientCreateInput = {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      email: values.email,
      birthDate: values.birthDate ? values.birthDate : undefined,
      notes: values.notes,
      messagingOptOut: values.messagingOptOut,
      whatsappOptIn: values.whatsappOptIn,
      preferredLocale: values.preferredLocale ? values.preferredLocale : undefined,
      duplicateAcknowledged: nextAckName,
      phoneSharingAcknowledged: nextAckPhone,
    };

    const parsed = patientCreateSchema.safeParse(candidate);
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

    setAckName(nextAckName);
    setAckPhone(nextAckPhone);
    setPending(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => null);

      if (response.ok) {
        setDuplicateWarning(null);
        onSuccess(body as PatientFormSuccess);
        return;
      }

      if (
        response.status === 409 &&
        body &&
        typeof body === "object" &&
        "error" in body &&
        Array.isArray((body as { duplicates?: unknown }).duplicates)
      ) {
        const errorBody = body as { error: { code: string; message: string }; duplicates: unknown };
        setDuplicateWarning({
          code: errorBody.error.code as DuplicateWarningState["code"],
          message: errorBody.error.message,
          duplicates: errorBody.duplicates as DuplicateWarningState["duplicates"],
        });
        return;
      }

      if (response.status === 422 && body?.error?.code === "INVALID_PHONE") {
        setFieldErrors((prev) => ({ ...prev, phone: body.error.message as string }));
        return;
      }

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleAcknowledge() {
    if (!duplicateWarning) return;
    const overrides: { ackName?: boolean; ackPhone?: boolean } = {};
    if (duplicateWarning.code === "DUPLICATE_CANDIDATES") overrides.ackName = true;
    if (duplicateWarning.code === "PHONE_ALREADY_REGISTERED") overrides.ackPhone = true;
    if (duplicateWarning.code === "INDISTINGUISHABLE_RECORDS") {
      overrides.ackName = true;
      overrides.ackPhone = true;
    }
    void submit(overrides);
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {duplicateWarning && (
        <DuplicateWarning
          warning={duplicateWarning}
          onAcknowledge={handleAcknowledge}
          acknowledging={pending}
        />
      )}

      {formError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      {/* Never a modal, never a `<dialog>`, never `window.confirm` — this
          form stays on screen and fully editable regardless of the banner
          above (tasks/todo.md acceptance criterion for this step). */}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="patient-lastName" className={labelClass}>
              Nom
            </label>
            <input
              id="patient-lastName"
              value={values.lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleDuplicateFieldChange("lastName", e.target.value)
              }
              dir="auto"
              aria-describedby={fieldErrors.lastName ? "patient-lastName-error" : undefined}
              aria-invalid={Boolean(fieldErrors.lastName)}
              className={inputClass}
            />
            {fieldErrors.lastName && (
              <p id="patient-lastName-error" className={errorTextClass}>
                {fieldErrors.lastName}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="patient-firstName" className={labelClass}>
              Prénom
            </label>
            <input
              id="patient-firstName"
              value={values.firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleDuplicateFieldChange("firstName", e.target.value)
              }
              dir="auto"
              aria-describedby={fieldErrors.firstName ? "patient-firstName-error" : undefined}
              aria-invalid={Boolean(fieldErrors.firstName)}
              className={inputClass}
            />
            {fieldErrors.firstName && (
              <p id="patient-firstName-error" className={errorTextClass}>
                {fieldErrors.firstName}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="patient-phone" className={labelClass}>
              Téléphone
            </label>
            <input
              id="patient-phone"
              value={values.phone}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleDuplicateFieldChange("phone", e.target.value)
              }
              dir="auto"
              aria-describedby={fieldErrors.phone ? "patient-phone-error" : undefined}
              aria-invalid={Boolean(fieldErrors.phone)}
              className={inputClass}
            />
            {fieldErrors.phone && (
              <p id="patient-phone-error" className={errorTextClass}>
                {fieldErrors.phone}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="patient-email" className={labelClass}>
              E-mail (facultatif)
            </label>
            <input
              id="patient-email"
              type="email"
              value={values.email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("email", e.target.value)}
              aria-describedby={fieldErrors.email ? "patient-email-error" : undefined}
              aria-invalid={Boolean(fieldErrors.email)}
              className={inputClass}
            />
            {fieldErrors.email && (
              <p id="patient-email-error" className={errorTextClass}>
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="patient-birthDate" className={labelClass}>
              Date de naissance (facultative)
            </label>
            <input
              id="patient-birthDate"
              type="date"
              value={values.birthDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("birthDate", e.target.value)}
              aria-describedby={fieldErrors.birthDate ? "patient-birthDate-error" : undefined}
              aria-invalid={Boolean(fieldErrors.birthDate)}
              className={inputClass}
            />
            {fieldErrors.birthDate && (
              <p id="patient-birthDate-error" className={errorTextClass}>
                {fieldErrors.birthDate}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="patient-preferredLocale" className={labelClass}>
              Langue préférée
            </label>
            <select
              id="patient-preferredLocale"
              value={values.preferredLocale}
              onChange={(e) =>
                handleChange("preferredLocale", e.target.value as FormValues["preferredLocale"])
              }
              className={inputClass}
            >
              <option value="">Non précisée (français par défaut)</option>
              <option value="fr">Français</option>
              <option value="ar">Arabe</option>
              <option value="en">Anglais</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="patient-notes" className={labelClass}>
            Notes (facultatives)
          </label>
          <textarea
            id="patient-notes"
            value={values.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
            dir="auto"
            rows={3}
            aria-describedby={fieldErrors.notes ? "patient-notes-error" : undefined}
            aria-invalid={Boolean(fieldErrors.notes)}
            className={inputClass}
          />
          {fieldErrors.notes && (
            <p id="patient-notes-error" className={errorTextClass}>
              {fieldErrors.notes}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={values.messagingOptOut}
              onChange={(e) => handleChange("messagingOptOut", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            />
            Ne pas envoyer de SMS/rappels
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={values.whatsappOptIn}
              onChange={(e) => handleChange("whatsappOptIn", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            />
            Accepte les messages WhatsApp
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
              hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-teal-600 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Enregistrement…" : "Enregistrer le patient"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700
                hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
