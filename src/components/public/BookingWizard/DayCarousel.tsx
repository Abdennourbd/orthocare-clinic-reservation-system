"use client";

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addClinicDays, clinicNoon } from "@/lib/time/clinicTime";

/**
 * Scrollable strip of day chips for the booking wizard's "Date & time" step,
 * covering the full reservable window (`today` → `maxDate`, driven by the
 * clinic's `maxHorizonDays` setting — never a hard-coded day count here).
 * Per plan.md §Refinement: Task 6 — Booking UI/UX, this replaces the old
 * fixed 7-day day-grid component (removed once this carousel was wired into
 * BookingWizard — étape 4).
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
 * - **Task 6R étape 4 update: the per-emission rate throttle that used to
 *   live here has moved to the parent.** Earlier revisions of this component
 *   throttled every `emit()` call (leading-edge, ~150ms) because each day
 *   change used to trigger its own `/api/slots` request immediately, and a
 *   swept keyboard/chevron/otherDate burst could fire dozens of them fast
 *   enough to hit the 120/min/IP cap. A security audit on étape 4 found that
 *   throttle bounded only the CADENCE of requests, not the total VOLUME of a
 *   sweep — and that the real budget overshoot came from
 *   `BookingWizard.tsx`'s `slotsCache` being wiped on every service change
 *   (comparing two services in one minute cost ~182 requests against the
 *   120/min cap). The fix was to give `BookingWizard.tsx`'s `loadSlots` a
 *   trailing debounce on the actual network fetch (one request per sweep,
 *   not one per day visited), plus in-flight request dedup and an
 *   `AbortController` for a day the patient has since left — see that
 *   file's `loadSlots`/`fetchAndCache`. Once that existed, the throttle here
 *   became redundant *and* harmful: it also ate one deliberate keystroke on
 *   a controlled component with no local state to catch it. **Do not
 *   re-add a per-emission throttle in this file** — the volume guard now
 *   lives where the network request actually happens, one layer up.
 * - `handleKeyDown` still ignores `e.repeat` outright (a held key does not
 *   need a throttle to be harmless: dropping every repeated keydown means
 *   at most one call per physical press, regardless of how long it's held).
 *   This guard is unrelated to rate-limiting and stays.
 * - **The equality guard lives on `emit()`, the single point where
 *   `onActiveDayChange` is actually called — not on a "step" helper.** A
 *   Tour 2 audit (back when a throttle also lived here) found that
 *   `stepByDays` guarded arrow keys and chevrons but NOT the `otherDate`
 *   `<input type="date">`: that input sits in a sibling `<div>` outside the
 *   keyboard-handled `role="group"`, so its `onChange` never went through
 *   `stepByDays` at all. Placing a guard on a step function instead of the
 *   emission point is exactly the kind of gap that reopens: any future
 *   emitter (a swipe gesture, a "jump to date" shortcut, …) that doesn't
 *   happen to call `stepByDays` would silently bypass it again. `emit()` is
 *   the only function that calls `onActiveDayChange`, from every source
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
 * - **Human-tester fix, round 1 (post-étape-4, SUPERSEDED — kept here so the
 *   next reader understands why round 2 exists): `otherDate` was first moved
 *   off `value={activeDate}` onto a local draft state (`dateDraft`), resynced
 *   from `activeDate` with a render-time adjustment.** That was only half a
 *   fix. It stopped the field from being wiped on every keystroke, but
 *   `setDateDraft(value)` inside `onChange` is itself a `setState` — so React
 *   still re-rendered on every single keystroke. A round-2 human test found
 *   the *next* symptom: typing a digit into the day segment jumped the
 *   caret straight to the month segment, so a two-digit day could never be
 *   typed. Re-rendering `<input type="date">` and reassigning its `value`
 *   prop resets the browser's native, per-segment editing cursor — it
 *   doesn't matter that the reasserted value was correct (it now mirrored
 *   the just-typed digit instead of the stale `activeDate`); the mere act of
 *   writing the `value` prop again is what resets the native widget's
 *   editing state.
 * - **Human-tester fix, round 2 (current): `otherDate` is UNCONTROLLED.** No
 *   `value` prop at all — `defaultValue={activeDate}` seeds it once at
 *   mount, and a `ref` (`otherDateInputRef`) is the only thing that ever
 *   touches its DOM value afterward. `onChange` reads `e.target.value`,
 *   applies the same format + `[today, maxDate]` bounds guards as before,
 *   and calls `emit(value)` when both pass — and does **nothing else**: no
 *   `setState`, so no re-render, so the native date-segment editor is never
 *   disturbed by this component while the patient is mid-keystroke. Syncing
 *   the field when `activeDate` changes for a reason OUTSIDE this input (a
 *   chip click, an arrow key, a chevron) is handled by a small `useEffect`
 *   that writes `inputRef.current.value = activeDate` imperatively — and
 *   only when the input does NOT currently have focus
 *   (`document.activeElement !== inputRef.current`), so an in-progress edit
 *   is never overwritten by an external change. `onBlur` is the only place
 *   left that judges the field: once editing is actually finished, a
 *   malformed or out-of-window value is reverted to `activeDate` directly on
 *   `e.target.value` (legitimate here — the edit is over). `emit()` remains
 *   the only path to `onActiveDayChange` (`grep -c "onActiveDayChange("` is
 *   still 1), and only a value that passes both the format regex and the
 *   `[today, maxDate]` bounds check ever reaches it from `onChange` — this
 *   guard did not move or weaken across either round of this fix.
 * - Base chips intentionally drop the old grid's `font-semibold` and reserve
 *   `font-bold` for the active day alone: on top of `aria-current`, it's a
 *   second, non-color signal of which day is selected (WCAG — see below).
 */

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

  // `otherDate` is uncontrolled (see header comment, "round 2") — this ref is
  // the only handle this component keeps on its DOM value.
  const otherDateInputRef = useRef<HTMLInputElement | null>(null);

  // Keeps the `otherDate` input in sync with an `activeDate` change that
  // originated OUTSIDE it (a chip click, an arrow key, a chevron, `Home`).
  // Deliberately skipped while the input has focus: overwriting it mid-edit
  // is exactly the bug round 2 fixes, just triggered from the other
  // direction (an external prop change instead of this component's own
  // `setState`). `el.value !== activeDate` avoids a no-op write on mount
  // (where `defaultValue` already seeded the correct value) — not required
  // for correctness (assigning `.value` to its own current value is
  // harmless), just avoids touching the DOM for nothing.
  useEffect(() => {
    const el = otherDateInputRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== activeDate) el.value = activeDate;
  }, [activeDate]);

  // Single funnel for every activeDate change this component can produce —
  // see header comment for why the equality guard lives HERE and not in a
  // "step" helper. `focus: true` is passed only by keyboard-originated
  // callers (arrow keys, chevrons, Home); a chip click or an `otherDate`
  // edit already has the pointer/input focus where the patient put it and
  // must not move it. There is deliberately no rate throttle here anymore —
  // see header comment: that guard now lives on BookingWizard's `loadSlots`
  // debounce, which is where the actual network request happens.
  const emit = useCallback(
    (nextDate: string, options?: { focus?: boolean }) => {
      if (nextDate === activeDate) return;
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
          className="flex flex-1 snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth sm:gap-2"
        >
          {days.map((d) => {
            // Defensive guard, not a live branch today: `days` is already
            // built bounded to [today, maxDate] above, so this is always
            // false. Kept (rather than dropped) in case a future change
            // grows `days` from a wider source without re-checking bounds
            // here.
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
          ref={otherDateInputRef}
          min={today}
          max={maxDate}
          defaultValue={activeDate}
          onKeyDown={(e) => {
            // Defense in depth: a held ArrowUp/ArrowDown on the native
            // date-segment spinner auto-repeats `keydown` (and a matching
            // `change` per repeat) just like a held keyboard arrow on the
            // strip. This just stops the browser from bothering to spin the
            // value at all while the key is held; the actual volume guard
            // for the resulting `/api/slots` traffic lives one layer up, in
            // BookingWizard's `loadSlots` debounce (see header comment).
            if (e.repeat) e.preventDefault();
          }}
          onChange={(e) => {
            // Uncontrolled input (see header comment, "round 2"): no
            // `setState` here at all. The browser already holds whatever it
            // just reported in `e.target.value` — nothing needs to mirror it
            // back. This is exactly what stops the native per-segment editor
            // from being disturbed: no `setState` means no re-render, means
            // nothing ever reassigns the input's `value`.
            const value = e.target.value;
            // `min`/`max` on <input type="date"> are validity hints, not a
            // filter — the browser does not stop `change` from firing with
            // an out-of-range or incomplete value (native segment editing
            // routinely passes through both while still mid-edit). Malformed
            // or out-of-window values are simply never forwarded to
            // `emit()` — this is the ONLY guard standing between a typed
            // value and `GET /api/slots`, and it is unchanged by the
            // uncontrolled rewrite: still a format regex, then the
            // `[today, maxDate]` bounds check, both before `emit()`.
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
            if (value < today || value > maxDate) return;
            emit(value);
          }}
          onBlur={(e) => {
            // The field is judged only once editing is actually finished. A
            // malformed value means the field was left mid-edit (e.g. tabbed
            // away before completing a segment); an out-of-window value has
            // no matching chip, which would otherwise strand the carousel
            // with both chevrons disabled. Either way, reverting to the last
            // accepted `activeDate` is the only sensible outcome — a valid,
            // in-window value was already forwarded to `emit()` on change and
            // is already equal to `activeDate` by the time blur fires, so
            // this is a no-op for it. Writing `e.target.value` directly is
            // legitimate here (unlike in `onChange`): the edit is over, so
            // there is no native segment-editing state left to disturb.
            const value = e.target.value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today || value > maxDate) {
              e.target.value = activeDate;
            }
          }}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
        />
      </div>
    </div>
  );
}
