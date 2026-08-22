"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { bookingInputSchema } from "@/schemas/booking";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";
import type { PublicService } from "@/lib/public/services";
import DatePicker from "./DatePicker";
import PatientForm, {
  type PatientFormErrors,
  type PatientFormValue,
} from "./PatientForm";
import SlotPicker, { type SlotDto } from "./SlotPicker";
import StepIndicator from "./StepIndicator";

export type BookingWizardInitialData = {
  services: PublicService[];
  consentVersion: string;
  /** Clinic-local today (YYYY-MM-DD). */
  today: string;
  maxHorizonDays: number;
};

type SlotResponse = { available: SlotDto[]; occupied: SlotDto[] };

type Step = 1 | 2 | 3 | 4 | 5 | "success";

const stepCardClass =
  "step-enter mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7";

/** Quiet chip recapping a choice made in an earlier step (display-only). */
function RecapChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
      {children}
    </span>
  );
}

const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";

function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 8.5l3.5 3.5L13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Step-back navigation with a direction-aware chevron (flips in RTL). */
function BackButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button type="button" onClick={onClick} className={secondaryButtonClass}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="h-4 w-4 rtl:-scale-x-100"
      >
        <path
          d="M10 3.5L5.5 8l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}

export default function BookingWizard({
  initialData,
}: {
  initialData: BookingWizardInitialData;
}) {
  const t = useTranslations("Booking");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const { services, consentVersion, today, maxHorizonDays } = initialData;
  const maxDate = addClinicDays(today, maxHorizonDays);

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );

  const [step, setStep] = useState<Step>(1);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotResponse | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [patient, setPatient] = useState<PatientFormValue>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    birthDate: "",
  });
  const [consent, setConsent] = useState(false);
  const [formErrors, setFormErrors] = useState<PatientFormErrors>({});
  const [watchDates, setWatchDates] = useState<string[]>([]);
  const [watchAddValue, setWatchAddValue] = useState("");
  const [suggestedWatchDates, setSuggestedWatchDates] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appointmentRef, setAppointmentRef] = useState<string | null>(null);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  const loadSlots = useCallback(
    async (svcId: string, d: string) => {
      setSlotsLoading(true);
      setSlotsError(false);
      setSlot(null);
      try {
        const res = await fetch(
          `/api/slots?serviceId=${encodeURIComponent(svcId)}&date=${d}&locale=${locale}`,
        );
        if (!res.ok) throw new Error(`slots: ${res.status}`);
        const body: SlotResponse & { available: SlotDto[]; occupied: SlotDto[] } =
          await res.json();
        setSlots({ available: body.available, occupied: body.occupied });
        // Remember browsed days with zero availability so the cancellation-
        // watch step can pre-suggest them.
        if (body.available.length === 0) {
          setSuggestedWatchDates((prev) =>
            prev.includes(d) ? prev : [...prev, d],
          );
        }
      } catch {
        setSlotsError(true);
        setSlots(null);
      } finally {
        setSlotsLoading(false);
      }
    },
    [locale],
  );

  const selectService = (id: string) => {
    setServiceId(id);
    setDate(null);
    setSlot(null);
    setSlots(null);
    setWatchDates([]);
    setFormError(null);
    setStep(2);
  };

  const selectDate = (d: string) => {
    setDate(d);
    setSlot(null);
    setFormError(null);
    if (serviceId) void loadSlots(serviceId, d);
    setStep(3);
  };

  const toggleWatch = (d: string) => {
    setWatchDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const addWatchDate = () => {
    if (!watchAddValue) return;
    const d = watchAddValue;
    if (d < today || d > maxDate) {
      setFormError(t("errorGeneric"));
      return;
    }
    if (watchDates.length >= 10) {
      setFormError(t("errorGeneric"));
      return;
    }
    setWatchDates((prev) => (prev.includes(d) ? prev : [...prev, d]));
    setWatchAddValue("");
  };

  const setFieldErrorsFromZod = (
    error: ReturnType<typeof bookingInputSchema.safeParse>,
  ) => {
    if (error.success) return;
    const errs: PatientFormErrors = {};
    for (const issue of error.error.issues) {
      const path = issue.path.join(".");
      if (path === "consent") errs.consent = t("consentRequired");
      else if (path === "patient.email") errs.email = t("errorEmail");
      else if (
        ["patient.firstName", "patient.lastName", "patient.phone"].includes(path)
      ) {
        const key = path.split(".")[1] as keyof PatientFormErrors;
        errs[key] = t("errorRequired");
      }
      // Unknown path: surfaced as a generic form error below.
    }
    setFormErrors(errs);
    // A failed parse that mapped to no field (e.g. a future-added path) must
    // still be visible — never fail silently.
    if (Object.keys(errs).length === 0) {
      setFormError(t("errorGeneric"));
    }
  };

  /** Validates patient fields + consent with the shared schema (no booking). */
  const patientStepValid = (): boolean => {
    const parsed = bookingInputSchema.safeParse({
      serviceId: serviceId ?? "",
      startTime: slot?.startUTC ?? "",
      patient: {
        firstName: patient.firstName.trim(),
        lastName: patient.lastName.trim(),
        phone: patient.phone.trim(),
        email: patient.email.trim() || undefined,
        birthDate: patient.birthDate || undefined,
      },
      consent,
      consentVersion,
    });
    if (!parsed.success) {
      setFieldErrorsFromZod(parsed);
      return false;
    }
    setFormErrors({});
    return true;
  };

  const submit = async () => {
    if (!serviceId || !slot) return;
    const payload = {
      serviceId,
      startTime: slot.startUTC,
      patient: {
        firstName: patient.firstName.trim(),
        lastName: patient.lastName.trim(),
        phone: patient.phone.trim(),
        email: patient.email.trim() || undefined,
        birthDate: patient.birthDate || undefined,
      },
      consent,
      consentVersion,
      watchDates,
    };

    const parsed = bookingInputSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrorsFromZod(parsed);
      setStep(4);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body: { error?: { code?: string }; appointment?: { id: string } } =
        await res.json().catch(() => ({}));

      if (res.status === 201 && body.appointment) {
        setAppointmentRef(body.appointment.id);
        setStep("success");
        return;
      }
      if (res.status === 409) {
        setFormError(t("errorConflict"));
        setStep(3);
        return;
      }
      if (res.status === 429) {
        setFormError(t("errorRateLimited"));
        return;
      }
      if (res.status === 422) {
        setFormError(t("errorPhone"));
        setStep(4);
        return;
      }
      if (res.status === 400 && body.error?.code === "STALE_CONSENT") {
        setFormError(t("errorGeneric"));
        return;
      }
      setFormError(t("errorGeneric"));
    } catch {
      setFormError(t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setServiceId(null);
    setDate(null);
    setSlot(null);
    setSlots(null);
    setPatient({ firstName: "", lastName: "", phone: "", email: "", birthDate: "" });
    setConsent(false);
    setFormErrors({});
    setWatchDates([]);
    setSuggestedWatchDates([]);
    setFormError(null);
    setAppointmentRef(null);
  };

  // ── Success ───────────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="step-enter mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm sm:p-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-semibold text-zinc-900">
          {t("successTitle")}
        </h2>
        {appointmentRef && (
          <p className="mt-3 text-sm text-zinc-600">
            {t("successRef")}:{" "}
            <span className="inline-block rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-medium text-zinc-800">
              {appointmentRef}
            </span>
          </p>
        )}
        <p className="mt-4 text-sm text-zinc-600">{t("successNote")}</p>
        <button
          type="button"
          onClick={reset}
          className={`${primaryButtonClass} mt-6`}
        >
          {t("bookAnother")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <StepIndicator
        steps={[
          t("stepService"),
          t("stepDate"),
          t("stepSlot"),
          t("stepInfo"),
          t("stepSummary"),
        ]}
        current={step}
      />

      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      {/* Step 1 — service */}
      {step === 1 && (
        <section
          className={`${stepCardClass} space-y-3`}
          aria-label={t("stepService")}
        >
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepService")}</h2>
          {services.map((s) => {
            const selected = s.id === serviceId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectService(s.id)}
                className={`flex w-full items-center gap-4 rounded-xl border p-4 text-start transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                  selected
                    ? "border-teal-600 bg-teal-50 shadow-sm"
                    : "border-zinc-300 bg-white hover:border-teal-400 hover:shadow-sm"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    selected
                      ? "bg-teal-600 text-white"
                      : "border border-zinc-300 text-transparent"
                  }`}
                >
                  <CheckIcon className="h-3 w-3" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-zinc-900">{s.name}</span>
                  <span className="mt-0.5 block text-sm text-zinc-500">
                    {s.description}
                  </span>
                </span>
                <span className="shrink-0 text-end text-sm">
                  <span className="block text-zinc-500">
                    {t("durationMinutes", { minutes: s.durationMinutes })}
                  </span>
                  <span className="block font-medium text-zinc-700">
                    {s.price ? `${s.price} ${s.currency}` : t("priceFree")}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* Step 2 — date */}
      {step === 2 && (
        <section className={stepCardClass} aria-label={t("stepDate")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepDate")}</h2>
          <p className="mt-1 text-sm text-zinc-600">{t("chooseDateHint")}</p>
          <div className="mt-4">
            <DatePicker
              today={today}
              maxDate={maxDate}
              selectedDate={date}
              onSelect={selectDate}
            />
          </div>
          <div className="mt-6">
            <BackButton onClick={() => setStep(1)} label={t("back")} />
          </div>
        </section>
      )}

      {/* Step 3 — slot */}
      {step === 3 && (
        <section className={stepCardClass} aria-label={t("stepSlot")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepSlot")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedService && <RecapChip>{selectedService.name}</RecapChip>}
            {date && <RecapChip>{dayFmt.format(clinicNoon(date))}</RecapChip>}
          </div>
          <div className="mt-4">
            {slotsLoading ? (
              <div
                role="status"
                aria-label={tCommon("loading")}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-zinc-100"
                  />
                ))}
              </div>
            ) : slotsError ? (
              <p role="alert" className="text-sm text-red-600">
                {t("errorGeneric")}
              </p>
            ) : slots ? (
              <SlotPicker
                dateLabel={date ? dayFmt.format(clinicNoon(date)) : date ?? ""}
                available={slots.available}
                occupied={slots.occupied}
                selectedStartUTC={slot?.startUTC ?? null}
                onSelect={(s) => {
                  setSlot(s);
                  setStep(4);
                }}
              />
            ) : null}
          </div>
          <div className="mt-6">
            <BackButton onClick={() => setStep(2)} label={t("back")} />
          </div>
        </section>
      )}

      {/* Step 4 — patient info */}
      {step === 4 && (
        <section className={stepCardClass} aria-label={t("stepInfo")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepInfo")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedService && <RecapChip>{selectedService.name}</RecapChip>}
            {date && <RecapChip>{dayFmt.format(clinicNoon(date))}</RecapChip>}
            {slot && <RecapChip>{slot.localTime}</RecapChip>}
          </div>
          <div className="mt-4">
            <PatientForm
              value={patient}
              consent={consent}
              errors={formErrors}
              onChange={(patch) => setPatient((p) => ({ ...p, ...patch }))}
              onConsentChange={setConsent}
            />
          </div>
          <div className="mt-6 flex gap-3">
            <BackButton onClick={() => setStep(3)} label={t("back")} />
            <button
              type="button"
              onClick={() => {
                if (patientStepValid()) setStep(5);
              }}
              className={primaryButtonClass}
            >
              {t("next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 5 — summary + cancellation watch + submit */}
      {step === 5 && selectedService && slot && date && (
        <section className={stepCardClass} aria-label={t("stepSummary")}>
          <h2 className="text-lg font-semibold text-zinc-900">
            {t("stepSummary")}
          </h2>

          <dl className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-zinc-500">{t("service")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {selectedService.name}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-zinc-500">{t("date")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {dayFmt.format(clinicNoon(date))}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-zinc-500">{t("time")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {slot.localTime}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-zinc-500">{t("patient")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {patient.firstName} {patient.lastName}
              </dd>
            </div>
          </dl>

          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("summaryConfirmNote")}
          </p>

          <fieldset className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
            <legend className="px-1 text-sm font-semibold text-zinc-900">
              {t("watchTitle")}
            </legend>
            <p className="text-sm text-zinc-600">{t("watchIntro")}</p>

            {suggestedWatchDates.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-zinc-700">
                  {t("watchSuggest")}
                </p>
                <ul className="mt-2 space-y-2">
                  {suggestedWatchDates.map((d) => (
                    <li key={d}>
                      <label className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={watchDates.includes(d)}
                          onChange={() => toggleWatch(d)}
                          className="h-4 w-4 accent-teal-600"
                        />
                        {dayFmt.format(clinicNoon(d))}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex items-end gap-3">
              <div>
                <label
                  htmlFor="watch-add"
                  className="mb-1 block text-sm font-medium text-zinc-700"
                >
                  {t("watchAddLabel")}
                </label>
                <input
                  id="watch-add"
                  type="date"
                  min={today}
                  max={maxDate}
                  value={watchAddValue}
                  onChange={(e) => setWatchAddValue(e.target.value)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
                />
              </div>
              <button
                type="button"
                onClick={addWatchDate}
                className="rounded-lg border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                {t("watchAdd")}
              </button>
            </div>

            <p className="mt-4 text-xs text-zinc-500">{t("watchOptOut")}</p>
          </fieldset>

          <div className="mt-6 flex gap-3">
            <BackButton onClick={() => setStep(4)} label={t("back")} />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className={primaryButtonClass}
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}