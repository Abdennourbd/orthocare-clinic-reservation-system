"use client";

import { useCallback, useMemo, useState } from "react";
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

export type BookingWizardInitialData = {
  services: PublicService[];
  consentVersion: string;
  /** Clinic-local today (YYYY-MM-DD). */
  today: string;
  maxHorizonDays: number;
};

type SlotResponse = { available: SlotDto[]; occupied: SlotDto[] };

type Step = 1 | 2 | 3 | 4 | 5 | "success";

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
      <div className="mx-auto max-w-xl rounded-2xl border border-teal-200 bg-teal-50 p-8 text-center">
        <h2 className="text-xl font-semibold text-teal-800">
          {t("successTitle")}
        </h2>
        {appointmentRef && (
          <p className="mt-2 text-sm text-zinc-600">
            {t("successRef")}: <span className="font-mono">{appointmentRef}</span>
          </p>
        )}
        <p className="mt-4 text-sm text-zinc-700">{t("successNote")}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-teal-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {t("bookAnother")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm text-zinc-500">
        {t("stepService")} → {t("stepDate")} → {t("stepSlot")} →{" "}
        {t("stepInfo")} → {t("stepSummary")}
      </p>

      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      {/* Step 1 — service */}
      {step === 1 && (
        <section className="mt-6 space-y-3" aria-label={t("stepService")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepService")}</h2>
          {services.map((s) => {
            const selected = s.id === serviceId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectService(s.id)}
                className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? "border-teal-600 bg-teal-50"
                    : "border-zinc-300 hover:border-teal-400"
                }`}
              >
                <span>
                  <span className="block font-semibold text-zinc-900">{s.name}</span>
                  <span className="mt-0.5 block text-sm text-zinc-500">
                    {s.description}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
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
        <section className="mt-6" aria-label={t("stepDate")}>
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
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-6 text-sm font-medium text-zinc-600 underline-offset-2 hover:underline"
          >
            {t("back")}
          </button>
        </section>
      )}

      {/* Step 3 — slot */}
      {step === 3 && (
        <section className="mt-6" aria-label={t("stepSlot")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepSlot")}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {selectedService?.name} — {date ? dayFmt.format(clinicNoon(date)) : ""}
          </p>
          <div className="mt-4">
            {slotsLoading ? (
              <p className="text-sm text-zinc-500">{tCommon("loading")}</p>
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
          <button
            type="button"
            onClick={() => setStep(2)}
            className="mt-6 text-sm font-medium text-zinc-600 underline-offset-2 hover:underline"
          >
            {t("back")}
          </button>
        </section>
      )}

      {/* Step 4 — patient info */}
      {step === 4 && (
        <section className="mt-6" aria-label={t("stepInfo")}>
          <h2 className="text-lg font-semibold text-zinc-900">{t("stepInfo")}</h2>
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
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("back")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (patientStepValid()) setStep(5);
              }}
              className="rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              {t("next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 5 — summary + cancellation watch + submit */}
      {step === 5 && selectedService && slot && date && (
        <section className="mt-6" aria-label={t("stepSummary")}>
          <h2 className="text-lg font-semibold text-zinc-900">
            {t("stepSummary")}
          </h2>

          <dl className="mt-4 space-y-2 rounded-xl border border-zinc-200 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">{t("service")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {selectedService.name}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">{t("date")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {dayFmt.format(clinicNoon(date))}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">{t("time")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {slot.localTime}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">{t("patient")}</dt>
              <dd className="text-right font-medium text-zinc-900">
                {patient.firstName} {patient.lastName}
              </dd>
            </div>
          </dl>

          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("summaryConfirmNote")}
          </p>

          <fieldset className="mt-6 rounded-xl border border-zinc-200 p-4">
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
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={addWatchDate}
                className="rounded-md border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
              >
                {t("watchAdd")}
              </button>
            </div>

            <p className="mt-4 text-xs text-zinc-500">{t("watchOptOut")}</p>
          </fieldset>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("back")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="rounded-full bg-teal-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}