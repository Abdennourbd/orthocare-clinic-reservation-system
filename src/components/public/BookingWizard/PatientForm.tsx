"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type PatientFormValue = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
};

export type PatientFormErrors = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  consent?: string;
};

type PatientFormProps = {
  value: PatientFormValue;
  consent: boolean;
  errors: PatientFormErrors;
  onChange: (patch: Partial<PatientFormValue>) => void;
  onConsentChange: (checked: boolean) => void;
};

const inputClass = (invalid: boolean) =>
  `w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-1 ${
    invalid
      ? "border-red-500 focus-visible:outline-red-500"
      : "border-zinc-300 focus-visible:outline-teal-600"
  }`;

/**
 * Patient details + consent step of the booking wizard. Mirrors the shared
 * `bookingInputSchema` shape so client errors match what the server validates.
 */
export default function PatientForm({
  value,
  consent,
  errors,
  onChange,
  onConsentChange,
}: PatientFormProps) {
  const t = useTranslations("Booking");

  const field = (
    key: keyof PatientFormValue,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <div>
      <label htmlFor={`pf-${key}`} className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <input
        id={`pf-${key}`}
        value={value[key]}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<PatientFormValue>)}
        aria-invalid={Boolean(errors[key])}
        {...props}
        className={inputClass(Boolean(errors[key]))}
      />
      {errors[key] && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", t("firstName"), { autoComplete: "given-name" })}
        {field("lastName", t("lastName"), { autoComplete: "family-name" })}
        {field("phone", t("phone"), {
          type: "tel",
          inputMode: "tel",
          autoComplete: "tel",
          placeholder: t("phoneHint"),
        })}
        {field("email", t("email"), {
          type: "email",
          inputMode: "email",
          autoComplete: "email",
        })}
      </div>
      <div className="sm:max-w-xs">
        {field("birthDate", t("birthDate"), { type: "date" })}
      </div>

      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onConsentChange(e.target.checked)}
            aria-invalid={Boolean(errors.consent)}
            className="mt-0.5 h-4 w-4 accent-teal-600"
          />
          <span className="text-sm text-zinc-700">
            {t("consent")}{" "}
            <Link href="/privacy" className="text-teal-700 underline">
              {t("privacyLink")}
            </Link>
          </span>
        </label>
        {errors.consent && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {errors.consent}
          </p>
        )}
      </div>
    </div>
  );
}