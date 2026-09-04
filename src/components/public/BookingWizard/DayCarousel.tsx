"use client";

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";

/**
 * Scrollable strip of day chips for the booking wizard's "Date & time" step,
 * covering the full reservable window (`today` → `maxDate`, driven by the
 * clinic's `maxHorizonDays` setting — never a hard-coded day count here).
 * Per plan.md §Refinement: Task 6 — Booking UI/UX, this replaces the old
 * fixed 7-day `DayPicker` grid.
 *
 * Design notes:
 * - Native CSS `scroll-snap` + a small keyboard/pointer handler, not a
 *   carousel library: swipe inertia, RTL mirroring and snapping all come
 *   free from the platform, and this task adds zero npm dependencies.
 * - `activeDate` is CONTROLLED by the parent (like a form input), not local
 *   state, so the displayed day and the loaded slot grid can never disagree.
 * - The active day is deliberately never derived from `onScroll` or an
 *   `IntersectionObserver`. `GET /api/slots` is rate-limited to 120
 *   requests/minute/IP (src/app/api/slots/route.ts); a day that changes on
 *   every pixel of a swipe would fire one request per day scrolled past and
 *   could get a legitimate patient rate-limited by their own clinic. The
 *   active day only ever changes on an explicit action: a chip click, an
 *   arrow key, a chevron, or the `otherDate` input.
 * - The SAME rate-limit risk applies to a held key or a held chevron click,
 *   not just to scroll: `keydown` auto-repeats 15-30 times/second while a
 *   key is held, and a native `<button>` fires one `click` per repeat while
 *   `Enter` is held too (Chrome/Firefox; `Space` is exempt because it fires
 *   on `keyup`). Two independent guards close this: `handleKeyDown` ignores
 *   `e.repeat` outright, and every activeDate change funnels through the
 *   single `emit()` below, which throttles to one emission every
 *   `STEP_THROTTLE_MS`. Do not remove either as "just a repaint nicety":
 *   without them, sweeping the ~90-day window in a few seconds fires dozens
 *   of `/api/slots` requests. A 429 on that path is NOT silently swallowed —
 *   `onActiveDateChange` in the parent calls `loadSlots`, whose failure sets
 *   `slotsError` and renders a `role="alert"` banner (BookingWizard.tsx) — so
 *   the patient does see something, but a burst of dozens of requests in a
 *   few seconds from one visitor is still the thing to prevent, not just to
 *   report. Only the parent's *background* `prefetchWeek` calls swallow a
 *   failure silently (`fetchAndCache`'s `catch { return null }`), because
 *   they're speculative pre-loads for days the patient hasn't asked to see
 *   yet.
 * - **The throttle and the equality guard live on `emit()`, the single point
 *   where `onActiveDayChange` is actually called — not on a "step" helper.**
 *   A Tour 2 audit found that `stepByDays` guarded arrow keys and chevrons
 *   but NOT the `otherDate` `<input type="date">`: that input sits in a
 *   sibling `<div>` outside the keyboard-handled `role="group"`, so its
 *   `onChange` never went through `stepByDays` at all. A held `ArrowUp` on
 *   the browser's native date-segment spinner auto-repeats exactly like a
 *   held keyboard arrow, firing a well-formed, in-window `change` event
 *   15-30 times/second — which passed both of `otherDate`'s validation
 *   guards (format, bounds) every time, because those guard the *value*, not
 *   the *rate*. Placing the guard on a step function instead of the emission
 *   point is exactly the kind of gap that reopens: any future emitter (a
 *   swipe gesture, a "jump to date" shortcut, …) that doesn't happen to call
 *   `stepByDays` would silently bypass the whole defense again. `emit()` is
 *   now the only function that calls `onActiveDayChange`, from every source
 *   (chips, arrow keys, chevrons, `Home`, `otherDate`) — new call sites must
 *   go through it too.
 * - Roving tabindex on the day chips (only the active chip has
 *   `tabIndex={0}`, the rest `-1`) keeps `Tab` from having to step through
 *   every one of the ~90 chips to reach the chevrons, the `otherDate` input,
 *   or the time grid below. INVARIANT this relies on: the parent must only
 *   ever pass an `activeDate` that is inside `[today, maxDate]`. If it isn't
 *   (a future caller's bug, not reachable today), no chip matches and
 *   `days[0]` — the first chip — gets `tabIndex={0}` instead, per the
 *   standard "no current item" roving-tabindex fallback, so the strip is
 *   never left with zero tabbable chips and both chevrons wrongly disabled.
 * - Programmatic `.focus()` follows an `activeDate` change that originated
 *   INSIDE this component (armed by `emit()`) — never on mount, and never
 *   when the parent changes `activeDate` for its own reasons, so the wizard
 *   never steals focus from the patient on first paint. The arming ref holds
 *   the *requested date* rather than a bare boolean, and the effect only
 *   moves focus if `activeDate` matches it exactly: a boolean armed by
 *   `Home` and never cleared (because the parent's `activeDate` didn't
 *   change — e.g. `Home` pressed while already on `today`) would otherwise
 *   stay armed and steal focus out of the `otherDate` input the next time
 *   the patient typed a valid date there. `focus()` also passes
 *   `{ preventScroll: true }`: the same effect already calls
 *   `scrollIntoView({ behavior: "smooth" })`, and a focus-triggered scroll
 *   racing the smooth one causes a visible stutter.
 * - Base chips intentionally drop `DayPicker`'s `font-semibold` and reserve
 *   `font-bold` for the active day alone: on top of `aria-current`, it's a
 *   second, non-color signal of which day is selected (WCAG — see below).
 */

/**
 * Minimum time between two `emit()` calls — the single funnel every
 * activeDate change goes through (chips, arrow keys, chevrons, `Home`,
 * `otherDate`). See the header comment for why this exists.
 */
const STEP_THROTTLE_MS = 150;

type DayCarouselProps = {
  /** Clinic-local today (YYYY-MM-DD), the lower bound of the window. */
  today: string;
  /** Clinic-local upper bound of the window (YYYY-MM-DD), from `maxHorizonDays`. */
  maxDate: string;
  /** Active day, controlled by the parent. */
  activeDate: string;
  onActiveDayChange: (date: string) => void;
  /** Optional slot to override the default chip body. */
  renderDay?: (date: string) => React.ReactNode;
};

/** Chevron pointing toward the start of the strip (mirrors in RTL). */
function StartChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100">
      <path
        d="M10 3.5L5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Chevron pointing toward the end of the strip (mirrors in RTL). */
function EndChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100">
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DayCarousel({
  today,
  maxDate,
  activeDate,
  onActiveDayChange,
  renderDay,
}: DayCarouselProps) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  // `ar` is the only RTL locale this project ships (fr/en/ar) — see
  // BackButton's identical `rtl:-scale-x-100` pattern in BookingWizard.tsx.
  // Physical arrow keys don't flip on their own (unlike CSS logical
  // properties), so keyboard direction has to be resolved explicitly here.
  const isRtl = locale === "ar";

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    [locale],
  );

  const days = useMemo(() => {
    const list: string[] = [];
    let d = today;
    // Safety cap only, not a business rule: guards against an infinite loop
    // if `maxDate` were ever misconfigured below `today`.
    for (let guard = 0; d <= maxDate && guard < 400; guard++) {
      list.push(d);
      d = addClinicDays(d, 1);
    }
    return list;
  }, [today, maxDate]);

  const activeRef = useRef<HTMLButtonElement | null>(null);
  // Timestamp (ms) of the last emission through `emit()`, shared by every
  // source of an activeDate change — see header comment for the rate-limit
  // rationale behind throttling it.
  const lastStepAtRef = useRef(0);
  // Holds the *date* that a keyboard-driven interaction (arrow key, chevron,
  // Home) just requested, or `null` when idle. Consumed by the effect below,
  // which only moves DOM focus if `activeDate` matches this exactly. Storing
  // the requested date rather than a bare "armed" boolean matters: `emit()`
  // no-ops when `nextDate === activeDate` (e.g. `Home` pressed while already
  // on `today`), so a boolean set right before that no-op would stay armed
  // forever with nothing left to clear it — and steal focus out from under
  // the patient the next time `activeDate` changed for an unrelated reason
  // (typing in `otherDate`). Comparing against the specific requested date
  // makes the flag self-clearing: it only ever matches the render it was
  // meant for.
  const focusRequestedDateRef = useRef<string | null>(null);

  useEffect(() => {
    // Programmatic scroll only, triggered by an explicit activeDate change —
    // never by the user's own scroll gesture. scrollIntoView doesn't exist
    // in jsdom, hence the optional-chained call.
    activeRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
    // Move DOM focus to the (now roving-tabbable) active chip only when this
    // exact date was requested from inside the carousel. Never on mount,
    // never when the parent re-renders with a new `activeDate` for reasons
    // of its own (e.g. `otherDate`) — either would rip focus away from
    // wherever the patient actually is on the page. `preventScroll` avoids
    // racing the `scrollIntoView` call above (both would otherwise try to
    // scroll the page on the same frame).
    if (focusRequestedDateRef.current === activeDate) {
      focusRequestedDateRef.current = null;
      activeRef.current?.focus?.({ preventScroll: true });
    }
  }, [activeDate]);

  // Single funnel for every activeDate change this component can produce —
  // see header comment for why the throttle and equality guard live HERE
  // and not in a "step" helper. `focus: true` is passed only by
  // keyboard-originated callers (arrow keys, chevrons, Home); a chip click
  // or an `otherDate` edit already has the pointer/input focus where the
  // patient put it and must not move it.
  const emit = useCallback(
    (nextDate: string, options?: { focus?: boolean }) => {
      if (nextDate === activeDate) return;
      // Throttle: a held arrow key, a held Enter on a chevron, or a held
      // ArrowUp/ArrowDown on the native <input type="date"> spinner all
      // auto-repeat many times per second (see header comment). Without
      // this, sweeping the window would fire a burst of /api/slots requests
      // fast enough to hit the 120/min/IP limit.
      const now = Date.now();
      if (now - lastStepAtRef.current < STEP_THROTTLE_MS) return;
      lastStepAtRef.current = now;
      if (options?.focus) focusRequestedDateRef.current = nextDate;
      onActiveDayChange(nextDate);
    },
    [activeDate, onActiveDayChange],
  );

  const stepByDays = useCallback(
    (delta: number) => {
      const idx = days.indexOf(activeDate);
      if (idx === -1) return;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= days.length) return;
      emit(days[nextIdx], { focus: true });
    },
    [days, activeDate, emit],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Ignore auto-repeated keydowns from a held key outright — see header
    // comment. This applies to Home too: harmless on its own (constant
    // target), but there's no reason to let it spam the callback either.
    if (e.repeat) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      // In RTL, the left key moves forward in time; in LTR it moves back.
      stepByDays(isRtl ? 1 : -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepByDays(isRtl ? -1 : 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      emit(today, { focus: true });
    }
  };

  const activeIdx = days.indexOf(activeDate);
  const prevDisabled = activeIdx <= 0;
  const nextDisabled = activeIdx === -1 || activeIdx >= days.length - 1;

  // Chevron clicks always move earlier / later in time — the strip's DOM
  // order stays chronological and `dir="rtl"` alone flips the visual layout
  // and the chevron glyph, exactly like BackButton's step-back chevron.
  const goPrev = () => stepByDays(-1);
  const goNext = () => stepByDays(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={prevDisabled}
          aria-label={t("prevDay")}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-colors hover:border-teal-400 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
        >
          <StartChevronIcon />
        </button>

        <div
          role="group"
          aria-label={t("dayCarouselLabel")}
          onKeyDown={handleKeyDown}
          className="flex flex-1 snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 sm:gap-2"
        >
          {days.map((d) => {
            // Defensive guard, not a live branch today: `days` is already
            // built bounded to [today, maxDate] above, so this is always
            // false. Kept (rather than dropped) in case a future change
            // grows `days` from a wider source without re-checking bounds
            // here — inherited from DayPicker, where a fixed 7-day grid
            // genuinely could run past the window.
            const disabled = d < today || d > maxDate;
            const active = d === activeDate;
            // Roving-tabindex fallback: if `activeDate` isn't in `days` (see
            // the INVARIANT note in the header comment — not reachable
            // today, but the parent isn't the one enforcing it), no chip is
            // "active" and the strip must still offer one tabbable entry
            // point, so the first chip takes it.
            const isTabbable = active || (activeIdx === -1 && d === days[0]);
            const parts = dayFmt.formatToParts(clinicNoon(d));
            const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
            return (
              <button
                key={d}
                ref={active ? activeRef : undefined}
                type="button"
                disabled={disabled}
                // Roving tabindex: only the active chip (or the fallback
                // above) is in the Tab sequence, so keyboard users reach the
                // chevrons / otherDate input / time grid without stepping
                // through every day.
                tabIndex={isTabbable ? 0 : -1}
                aria-current={active ? "date" : undefined}
                aria-pressed={active}
                aria-label={dayFmt.format(clinicNoon(d))}
                onClick={() => emit(d)}
                className={`flex shrink-0 snap-start flex-col items-center rounded-xl border px-2 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                  disabled
                    ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300"
                    : active
                      ? "border-2 border-teal-600 bg-teal-600 font-bold text-white shadow-sm"
                      : "border-zinc-300 bg-white text-zinc-800 hover:border-teal-400 hover:text-teal-700 hover:shadow-sm"
                }`}
              >
                {renderDay ? (
                  renderDay(d)
                ) : (
                  <>
                    <span className="text-[0.625rem] opacity-75 sm:text-xs">{part("weekday")}</span>
                    <span className="mt-0.5 text-base leading-6 sm:text-lg">{part("day")}</span>
                    <span className="text-[0.625rem] opacity-75 sm:text-xs">{part("month")}</span>
                    {/* Today marker: always rendered (invisible when not
                        today) so every chip keeps the same height. */}
                    <span
                      aria-hidden="true"
                      className={`mt-1 h-1 w-1 rounded-full ${
                        d === today ? (active ? "bg-white" : "bg-teal-500") : "invisible"
                      }`}
                    />
                  </>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={nextDisabled}
          aria-label={t("nextDay")}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-colors hover:border-teal-400 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
        >
          <EndChevronIcon />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="booking-date" className="text-sm text-zinc-600">
          {t("otherDate")}
        </label>
        <input
          id="booking-date"
          type="date"
          min={today}
          max={maxDate}
          value={activeDate}
          onKeyDown={(e) => {
            // Defense in depth, not the primary guard: a held ArrowUp/
            // ArrowDown on the native date-segment spinner auto-repeats
            // `keydown` (and a matching `change` per repeat) just like a
            // held keyboard arrow on the strip. The real protection is
            // `emit()`'s throttle below, which every `onChange` value —
            // repeat-driven or not — has to pass through; this just stops
            // the browser from bothering to spin the value at all while the
            // component is mid-throttle.
            if (e.repeat) e.preventDefault();
          }}
          onChange={(e) => {
            const value = e.target.value;
            // `min`/`max` on <input type="date"> are validity hints, not a
            // filter: the browser still fires `change` with an out-of-range
            // value (and once per keystroke while typing a year digit by
            // digit, or repeatedly while a spinner arrow is held — see the
            // `onKeyDown` above and the header comment). Reject anything
            // malformed or outside the reservable window before it reaches
            // `emit()` — an out-of-window date also has no matching chip,
            // which would strand the carousel with both chevrons disabled.
            // No message is shown for a rejected value — that would need a
            // string in all 3 locales for what is normally mid-typing noise
            // (see below). Deliberate split between the two rejections:
            // - Malformed (typically an EMPTY value: the browser holds "" on
            //   its native <input type="date"> until every segment is
            //   filled): left alone, value untouched. This branch fires on
            //   every keystroke while a segment is incomplete, so forcing
            //   `e.target.value` back to `activeDate` here would fight the
            //   patient's own typing and make it impossible to ever finish
            //   entering a new date by keyboard.
            // - Well-formed but out-of-window (a complete date from a
            //   spinner-arrow repeat, or a fully typed out-of-range date):
            //   forced back to `activeDate` right away. `value={activeDate}`
            //   only re-syncs the DOM on React's NEXT render, and nothing
            //   here re-renders DayCarousel when a value is rejected (the
            //   parent's `activeDate` didn't change) — without this line the
            //   browser would keep showing the rejected, out-of-window date
            //   on screen indefinitely, with no chip to match it either.
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
            if (value < today || value > maxDate) {
              e.target.value = activeDate;
              return;
            }
            emit(value);
          }}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
        />
      </div>
    </div>
  );
}
