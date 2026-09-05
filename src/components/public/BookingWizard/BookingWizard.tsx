"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { bookingInputSchema } from "@/schemas/booking";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";
import type { PublicService } from "@/lib/public/services";
import DayCarousel from "./DayCarousel";
import PatientForm, {
  type PatientFormErrors,
  type PatientFormValue,
} from "./PatientForm";
import StepIndicator from "./StepIndicator";
import TimeGrid, { type SlotDto } from "./TimeGrid";

export type BookingWizardInitialData = {
  services: PublicService[];
  consentVersion: string;
  /** Clinic-local today (YYYY-MM-DD). */
  today: string;
  maxHorizonDays: number;
};

type SlotResponse = { available: SlotDto[]; occupied: SlotDto[] };

type Step = 1 | 2 | 3 | 4 | "success";

/** Trailing debounce delay (ms) before `loadSlots` actually fires the
 *  network request for a cache-miss day. See `loadSlots` below and
 *  DayCarousel's header comment — Task 6R étape 4 closure condition. */
const LOAD_SLOTS_DEBOUNCE_MS = 280;

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
  const [activeDate, setActiveDate] = useState<string>(today);
  /** Clinic-local day of the selected slot (recap / summary). */
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
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [formErrors, setFormErrors] = useState<PatientFormErrors>({});
  const [watchDates, setWatchDates] = useState<string[]>([]);
  const [watchAddValue, setWatchAddValue] = useState("");
  const [suggestedWatchDates, setSuggestedWatchDates] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appointmentRef, setAppointmentRef] = useState<string | null>(null);

  /** Per-day slot cache, keyed by service+date: a browsed day never refetches,
   *  and a stale in-flight fetch for a PREVIOUS service can never overwrite
   *  the current service's slots (different key namespace). */
  const slotsCache = useRef<Map<string, SlotResponse>>(new Map());
  /** Mirrors `activeDate` so async slot fetches know which day to render. */
  const activeDateRef = useRef(activeDate);
  useEffect(() => {
    activeDateRef.current = activeDate;
  }, [activeDate]);
  /** Mirrors `serviceId` so stale in-flight fetches for a previous service
   *  never pollute the current service's watch suggestions. */
  const serviceIdRef = useRef(serviceId);
  useEffect(() => {
    serviceIdRef.current = serviceId;
  }, [serviceId]);
  const cacheKey = (svcId: string, d: string) => `${svcId}:${d}`;

  /** Pending trailing-debounce timer for `loadSlots` (Task 6R étape 4 closure
   *  condition). A day-to-day sweep (arrow keys, chip clicks) no longer fires
   *  one `/api/slots` request per day visited — see `loadSlots` below. */
  const loadSlotsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Holds the `AbortController` for the `/api/slots` request `runSlotFetch`
   *  most recently started. Tour de correction final (MAJEUR 1): this is no
   *  longer used to cancel a day the patient has since left — `runSlotFetch`
   *  used to unconditionally abort whatever this ref held before starting a
   *  new request, which sounds harmless but is not: it aborts ANY previous
   *  request regardless of which day it belonged to, including one for a
   *  DIFFERENT day that is still legitimately in flight. On a slow
   *  connection (dwell time between day switches < round-trip latency,
   *  ordinary on mobile in Algiers) that request never gets a chance to
   *  land, so it never fills `slotsCache` — the day gets re-requested from
   *  scratch every time it's revisited, and the abort()ed request is billed
   *  against the rate limiter without ever paying off in a cache entry.
   *  Measured before this fix: 150-207 requests/minute on a slow-network
   *  sweep, unbounded by the ~91-day window. Leaving previous requests to
   *  land (this ref is now only ever assigned, never used to `.abort()` a
   *  day-to-day request) lets every distinct day requested actually reach
   *  the cache once, which is what bounds the real volume — see `loadSlots`
   *  below. `selectService`/`reset` still call `.abort()` on this ref
   *  directly (not through `runSlotFetch`): switching service or resetting
   *  the whole wizard IS a legitimate reason to drop a request whose result
   *  can never apply anymore, and that is unrelated to this fix. This ref
   *  is still assigned on every `runSlotFetch` call and read by the
   *  stale-response guard there as an IDENTITY token — a superseded call
   *  must not overwrite a newer one's result — see that guard's comment. */
  const loadSlotsAbortRef = useRef<AbortController | null>(null);
  /** In-flight `/api/slots` requests keyed like `slotsCache`, so a request
   *  already underway for a given service+date (e.g. started by
   *  `prefetchWeek`) is reused instead of duplicated when `loadSlots` lands
   *  on the same day a moment later. Stores the request's `AbortSignal`
   *  alongside its promise (Tour de correction 1, BLOQUANT): `abort()` sets
   *  `signal.aborted` SYNCHRONOUSLY, but the aborted `fetch()` promise only
   *  rejects on a later microtask, and the `finally` below that clears this
   *  map entry runs later still. Without checking `signal.aborted` here,
   *  `runSlotFetch` could abort its own previous request and then, in the
   *  very next line, dedupe against that same now-doomed promise — reusing a
   *  request that is guaranteed to resolve `null` and paint an error banner
   *  on the day the patient just re-selected. A missing/undefined `signal`
   *  (every call from `prefetchWeek`, which never aborts) is never treated
   *  as aborted, so background prefetch dedup is unaffected. */
  const inFlightRef = useRef<
    Map<string, { promise: Promise<SlotResponse | null>; signal?: AbortSignal }>
  >(new Map());

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  /** Fetch one day's slots, cache them, and record zero-availability for the
   *  cancellation-watch suggestions. Returns null on failure (caller decides
   *  whether to surface an error). Deduplicates against `inFlightRef`: a
   *  request already underway for the same service+date (from
   *  `prefetchWeek`, or a previous call here) is reused rather than
   *  duplicated — this is the "in-flight request dedup" half of the Task 6R
   *  étape 4 closure condition. `signal` is only ever passed by `loadSlots`'
   *  own trailing-debounced fetch; a shared/deduped promise (started by
   *  `prefetchWeek`, which never aborts) ignores it, at best "by
   *  construction" in one direction only (Tour de correction 1, MINEUR):
   *  the underlying `fetch()` call only ever honours the FIRST caller's
   *  signal, so a `signal` passed by a SECOND, deduped caller is silently
   *  dropped rather than actually wired to anything — nothing guarantees
   *  that caller's own abort later does anything either. */
  const fetchAndCache = useCallback(
    (svcId: string, d: string, signal?: AbortSignal): Promise<SlotResponse | null> => {
      const key = cacheKey(svcId, d);
      const existing = inFlightRef.current.get(key);
      // Tour de correction 1 (BLOQUANT): never dedupe against a request
      // whose signal is already aborted — see the `inFlightRef` comment
      // above for why this can't just be "delete on abort" or "delete in
      // finally" alone.
      if (existing && !existing.signal?.aborted) return existing.promise;
      // `entry` (not the bare promise) is what identifies THIS call's map
      // slot below — the `finally` block needs to compare against it before
      // `entry.promise` itself is assigned, which a direct self-reference to
      // a `const promise = (async () => { ...promise... })()` can't do
      // (TS2454: used before being assigned — the closure runs after
      // `await`, safely past that point at runtime, but TS can't see that).
      const entry: { promise: Promise<SlotResponse | null>; signal?: AbortSignal } = {
        promise: null as unknown as Promise<SlotResponse | null>,
        signal,
      };
      // Tour de correction final (MINEUR 4): the map entry is registered
      // BEFORE `entry.promise` is assigned below, not after. If `fetch()`
      // ever threw synchronously (never happens with the browser's own
      // `fetch`, which only ever rejects — but nothing in this file's types
      // guarantees that), the async IIFE's `catch`/`finally` would run to
      // completion synchronously, before control ever reaches the old
      // `inFlightRef.current.set(key, entry)` call that used to sit after
      // it. The `finally`'s `inFlightRef.current.get(key) === entry` check
      // would then find nothing (the entry was never registered yet) and
      // skip cleanup — and the subsequent `.set()` would then plant an
      // already-settled entry that no `finally` will ever remove, making
      // every future call for this key dedupe against a promise stuck
      // forever on its resolved value. Registering first closes that gap.
      inFlightRef.current.set(key, entry);
      entry.promise = (async () => {
        try {
          const res = await fetch(
            `/api/slots?serviceId=${encodeURIComponent(svcId)}&date=${d}&locale=${locale}`,
            signal ? { signal } : undefined,
          );
          if (!res.ok) throw new Error(`slots: ${res.status}`);
          const body: SlotResponse = await res.json();
          // Keyed by service: a stale response for a previous service lands
          // in its own namespace and can never overwrite the current one.
          // Watch suggestions only count when the fetch is still current.
          slotsCache.current.set(key, body);
          if (body.available.length === 0 && svcId === serviceIdRef.current) {
            setSuggestedWatchDates((prev) =>
              prev.includes(d) ? prev : [...prev, d],
            );
          }
          return body;
        } catch {
          // Covers both a real network/HTTP failure and an aborted request
          // (loadSlots left this day before the fetch finished) — either
          // way there is nothing to render for this day, and the caller
          // already checks whether it still cares before touching state.
          return null;
        } finally {
          // Only clear the map entry if it's still THIS call's entry — an
          // aborted request's `finally` must never wipe out a newer,
          // still-in-flight request for the same key that replaced it (see
          // the dedup check above).
          if (inFlightRef.current.get(key) === entry) {
            inFlightRef.current.delete(key);
          }
        }
      })();
      return entry.promise;
    },
    [locale],
  );

  /** Fires the actual `/api/slots` request for `loadSlots`' trailing
   *  debounce, once the patient has stopped moving for
   *  `LOAD_SLOTS_DEBOUNCE_MS`. Tour de correction final (MAJEUR 1):
   *  deliberately does NOT cancel a previous in-flight request anymore — see
   *  `loadSlotsAbortRef`'s comment for why that abort() was itself the cause
   *  of the request-budget overshoot it was meant to prevent. Do not
   *  reintroduce it here. */
  const runSlotFetch = useCallback(
    async (svcId: string, d: string) => {
      const controller = new AbortController();
      loadSlotsAbortRef.current = controller;
      const body = await fetchAndCache(svcId, d, controller.signal);
      // Stale-response guard. Two independent reasons a settled response can
      // no longer be trusted:
      //  1. `d`/`svcId` mismatch — the patient moved to a different day or
      //     service during the debounce/fetch.
      //  2. `loadSlotsAbortRef.current !== controller` (Tour de correction 1,
      //     found while testing the BLOQUANT fix): re-arriving on the SAME
      //     day whose earlier request is still in flight aborts it and starts
      //     a fresh one, but the OLDER call is still sitting on this very
      //     `await` — it does not know it's been superseded. Its own
      //     `controller` was aborted, `body` resolves to `null`, and without
      //     this check it would still pass the `d`/`svcId` check (the day
      //     never changed) and paint a transient error banner on the exact
      //     day the patient is looking at, moments before the fresh request
      //     for that same day resolves successfully and overwrites it. This
      //     is the "no slotsError" scenario a fresh day A → B → back-to-A
      //     round trip must never produce.
      if (
        d !== activeDateRef.current ||
        svcId !== serviceIdRef.current ||
        loadSlotsAbortRef.current !== controller
      ) {
        return;
      }
      if (body) {
        setSlots(body);
        setSlotsError(false);
      } else {
        setSlotsError(true);
        setSlots(null);
      }
      setSlotsLoading(false);
    },
    [fetchAndCache],
  );

  /** Render the slots for the active day. A cache hit is instant — no
   *  network, no debounce, the day change on screen must never wait for one.
   *  A cache miss shows the loading state immediately (the visual change
   *  stays instant) but only actually schedules the `/api/slots` request
   *  after `LOAD_SLOTS_DEBOUNCE_MS` of no further day change.
   *
   *  Task 6R étape 4 closure condition (MAJOR 3): DayCarousel's old
   *  per-emission throttle bounded the CADENCE of day changes (one every
   *  ~150ms) but not the total VOLUME of a sweep — a thorough patient could
   *  still visit dozens of distinct days, each a cache miss, each its own
   *  request. The real overshoot was `slotsCache` being wiped on every
   *  service change (`selectService`/`reset` below): comparing two services
   *  inside one minute cost ~182 requests against the 120/min/IP cap on
   *  `GET /api/slots` (src/app/api/slots/route.ts). A TRAILING debounce
   *  helps: a fast sweep across many days that never lingers
   *  `LOAD_SLOTS_DEBOUNCE_MS` on any one of them fires no request at all
   *  until the patient actually stops, instead of one per chip visited by
   *  the old leading throttle. Tour de correction final (MAJEUR 1)
   *  correction: this does NOT mean "sweeping the whole ~90-day window
   *  costs exactly ONE request" — that was only true if `fetch()` latency
   *  never exceeds the time spent settled on a day, which does not hold on
   *  a slow connection (ordinary on mobile in Algiers: 400-1200ms). The
   *  actual bound on request volume is "at most one real request per
   *  DISTINCT day the patient ever settles on for `LOAD_SLOTS_DEBOUNCE_MS`",
   *  enforced by `slotsCache` (settled days are never refetched) and
   *  `inFlightRef`'s dedup (a day already in flight is never refetched
   *  either) — NOT by the debounce timer alone, and NOT by aborting
   *  superseded requests (removed, see `loadSlotsAbortRef`). */
  const loadSlots = useCallback(
    (svcId: string, d: string) => {
      if (loadSlotsTimerRef.current) clearTimeout(loadSlotsTimerRef.current);
      const cached = slotsCache.current.get(cacheKey(svcId, d));
      if (cached) {
        setSlotsError(false);
        setSlot(null);
        setSlots(cached);
        setSlotsLoading(false);
        return;
      }
      setSlotsLoading(true);
      setSlotsError(false);
      setSlot(null);
      loadSlotsTimerRef.current = setTimeout(() => {
        void runSlotFetch(svcId, d);
      }, LOAD_SLOTS_DEBOUNCE_MS);
    },
    [runSlotFetch],
  );

  /** Prefetch the next 7 days' slots in parallel the moment the user enters
   *  the date & time step, so switching days is instant (cache hit) instead of
   *  a per-click wait. Only the active day's result is rendered mid-flight;
   *  the rest just populate the cache. */
  const prefetchWeek = useCallback(
    async (svcId: string, firstDay: string) => {
      const days = Array.from({ length: 7 }, (_, i) =>
        addClinicDays(firstDay, i),
      );
      await Promise.all(
        days.map(async (d) => {
          const cached = slotsCache.current.get(cacheKey(svcId, d));
          if (cached) {
            if (d === activeDateRef.current) {
              setSlots(cached);
              setSlotsLoading(false);
            }
            return;
          }
          const body = await fetchAndCache(svcId, d);
          if (body && d === activeDateRef.current) {
            setSlots(body);
            setSlotsError(false);
            setSlotsLoading(false);
          }
        }),
      );
      // If the active day's slots never loaded (all failed), stop the spinner.
      if (!slotsCache.current.has(cacheKey(svcId, activeDateRef.current))) {
        setSlotsError(true);
        setSlots(null);
        setSlotsLoading(false);
      }
    },
    [fetchAndCache],
  );

  /** Tour de correction final (MAJEUR 3): rebuilds the cancellation-watch
   *  suggestions for a service from whatever `slotsCache` already holds,
   *  instead of always starting from `[]`. `fetchAndCache` is the ONLY
   *  writer of `suggestedWatchDates`, and it only runs on a cache MISS — so
   *  once a day is cached, revisiting it (even under a re-selected service)
   *  never calls `fetchAndCache` again and can never re-add it. Without
   *  this, browsing service A (accumulating zero-availability days),
   *  switching to B, then back to A left the summary step with NO
   *  suggestions at all for A's already-cached days, silently, for the rest
   *  of the session. Scanning the cache for this service's own
   *  zero-availability entries reconstructs exactly what a fresh fetch
   *  would have reported. */
  const suggestedWatchDatesFromCache = (svcId: string): string[] => {
    const prefix = `${svcId}:`;
    const dates: string[] = [];
    for (const [key, body] of slotsCache.current) {
      if (key.startsWith(prefix) && body.available.length === 0) {
        dates.push(key.slice(prefix.length));
      }
    }
    return dates;
  };

  const selectService = (id: string) => {
    // Cancel any debounced/in-flight fetch left over from the previous
    // service — it targets a service the patient just left, and its result
    // (if any) must never land as this new service's slots.
    if (loadSlotsTimerRef.current) clearTimeout(loadSlotsTimerRef.current);
    loadSlotsAbortRef.current?.abort();
    setServiceId(id);
    // Tour de correction 1 (MAJEUR 2): deliberately NOT wiping `slotsCache`
    // here. Its keys are already namespaced `${serviceId}:${date}` (see
    // `cacheKey` above), so a cached day from a previous service can never
    // be served for this one — wiping the whole map on every service change
    // was a redundant defense that doubled the worst-case request volume a
    // patient could rack up (comparing two services inside one minute used
    // to cost every day revisited twice against the 120/min/IP cap on
    // `GET /api/slots`). `reset()` below still wipes it: a full restart
    // ("book another appointment") has no reason to hold onto any of it.
    const firstDay = today;
    activeDateRef.current = firstDay;
    setActiveDate(firstDay);
    setDate(null);
    setSlot(null);
    setSlots(null);
    setSlotsError(false);
    // Tour de correction final (MAJEUR 3): rebuild from cache rather than
    // reset to `[]` — see `suggestedWatchDatesFromCache` above.
    setSuggestedWatchDates(suggestedWatchDatesFromCache(id));
    setWatchDates([]);
    setFormError(null);
    setSlotsLoading(true);
    void prefetchWeek(id, firstDay);
    setStep(2);
  };

  const onActiveDateChange = useCallback(
    (d: string) => {
      setActiveDate(d);
      if (serviceId) void loadSlots(serviceId, d);
    },
    [serviceId, loadSlots],
  );

  const selectSlot = useCallback(
    (s: SlotDto) => {
      setDate(activeDate);
      setSlot(s);
      setFormError(null);
      setStep(3);
    },
    [activeDate],
  );

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
      locale,
      whatsappOptIn,
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
      locale,
      whatsappOptIn,
    };

    const parsed = bookingInputSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrorsFromZod(parsed);
      setStep(3);
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
        // Tour de correction final (MAJEUR 2): the slot just lost is still
        // sitting in `slotsCache` marked available — without invalidating
        // it, the patient lands back on step 2 seeing the exact slot they
        // just failed to book, re-picks it, and gets another 409. Wiping
        // only this one service+date entry (never the whole cache — that
        // was the regression the previous round already fixed) and
        // reloading it, same pattern as the step-3 BackButton above, makes
        // the grid reflect reality again.
        if (serviceId && date) {
          slotsCache.current.delete(cacheKey(serviceId, date));
          void loadSlots(serviceId, date);
        }
        setFormError(t("errorConflict"));
        setStep(2);
        return;
      }
      if (res.status === 429) {
        // The API returns 429 for two distinct conditions: a real flood
        // (RATE_LIMITED) and hitting the active-PENDING cap (PENDING_LIMIT).
        // They need different messages — "too many requests" is meaningless
        // when the real cause is "you already have 3 pending bookings".
        setFormError(
          body.error?.code === "PENDING_LIMIT"
            ? t("errorPendingLimit")
            : t("errorRateLimited"),
        );
        return;
      }
      if (res.status === 422) {
        setFormError(t("errorPhone"));
        setStep(3);
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
    if (loadSlotsTimerRef.current) clearTimeout(loadSlotsTimerRef.current);
    loadSlotsAbortRef.current?.abort();
    setStep(1);
    setServiceId(null);
    setActiveDate(today);
    setDate(null);
    setSlot(null);
    setSlots(null);
    slotsCache.current = new Map();
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
          t("stepDateTime"),
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

      {/* Step 2 — date & time (combined) */}
      {step === 2 && (
        <section className={stepCardClass} aria-label={t("stepDateTime")}>
          <h2 className="text-lg font-semibold text-zinc-900">
            {t("stepDateTime")}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">{t("chooseDateHint")}</p>
          <div className="mt-4">
            {selectedService && (
              <DayCarousel
                today={today}
                maxDate={maxDate}
                activeDate={activeDate}
                onActiveDayChange={onActiveDateChange}
              />
            )}
          </div>
          <div className="mt-5">
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
              <p role="alert" className="py-2 text-sm text-red-600">
                {t("errorGeneric")}
              </p>
            ) : slots ? (
              <TimeGrid
                dateLabel={dayFmt.format(clinicNoon(activeDate))}
                available={slots.available}
                occupied={slots.occupied}
                selectedStartUTC={slot?.startUTC ?? null}
                onSelect={selectSlot}
              />
            ) : null}
          </div>
          <div className="mt-6">
            <BackButton onClick={() => setStep(1)} label={t("back")} />
          </div>
        </section>
      )}

      {/* Step 3 — patient info */}
      {step === 3 && (
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
              whatsappOptIn={whatsappOptIn}
              errors={formErrors}
              onChange={(patch) => setPatient((p) => ({ ...p, ...patch }))}
              onConsentChange={setConsent}
              onWhatsappOptInChange={setWhatsappOptIn}
            />
          </div>
          <div className="mt-6 flex gap-3">
            <BackButton
              onClick={() => {
                setActiveDate(date ?? today);
                if (serviceId && date) void loadSlots(serviceId, date);
                setStep(2);
              }}
              label={t("back")}
            />
            <button
              type="button"
              onClick={() => {
                if (patientStepValid()) setStep(4);
              }}
              className={primaryButtonClass}
            >
              {t("next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 4 — summary + cancellation watch + submit */}
      {step === 4 && selectedService && slot && date && (
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

            {watchDates.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-zinc-700">
                  {t("watchYourDays")}
                </p>
                <ul className="mt-2 space-y-2">
                  {watchDates.slice().sort().map((d) => (
                    <li key={d}>
                      <label className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked
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

            {suggestedWatchDates.filter((d) => !watchDates.includes(d))
              .length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-zinc-700">
                  {t("watchSuggest")}
                </p>
                <ul className="mt-2 space-y-2">
                  {suggestedWatchDates
                    .filter((d) => !watchDates.includes(d))
                    .map((d) => (
                      <li key={d}>
                        <label className="flex items-center gap-3 text-sm">
                          <input
                            type="checkbox"
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
            <BackButton onClick={() => setStep(3)} label={t("back")} />
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
