// @vitest-environment jsdom
//
// Component test for DayCarousel (Task 6R étape 3, plan.md §Refinement:
// Task 6 — Booking UI/UX). Covers everything a human eye is NOT needed for:
// the rendered window of chips, aria-current, keyboard navigation in both
// LTR and RTL, chevron disabled state at the window edges, and the fact that
// `activeDate` is controlled (the component only ever calls
// `onActiveDayChange`, it never re-renders a different active day on its
// own). Real scroll-snap, swipe and on-screen RTL direction are NOT
// observable by jsdom (no rendering engine) — those stay in étape 5's human
// recipe, per the relay file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import DayCarousel from "./DayCarousel";
import fr from "../../../../messages/fr.json";
import ar from "../../../../messages/ar.json";

// jsdom does not implement scrollIntoView; DayCarousel calls it optionally
// (`activeRef.current?.scrollIntoView?.(...)`) so this should be a no-op if
// left unstubbed, but stub it anyway so the test also proves the real
// implementation doesn't throw when the API IS present (as it is in every
// real browser).
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A small, deterministic window: today .. today+6 (7 chips), well clear of
// any DST/month-boundary edge case.
const TODAY = "2026-09-04";
const MAX_DATE = "2026-09-10"; // today + 6 days inclusive → 7 chips
const DAYS = ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];

function renderCarousel(props: {
  activeDate: string;
  onActiveDayChange: (date: string) => void;
  locale?: "fr" | "ar";
}) {
  const { activeDate, onActiveDayChange, locale = "fr" } = props;
  const messages = locale === "ar" ? ar : fr;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DayCarousel
        today={TODAY}
        maxDate={MAX_DATE}
        activeDate={activeDate}
        onActiveDayChange={onActiveDayChange}
      />
    </NextIntlClientProvider>,
  );
}

/** The scrollable strip is the one `role="group"` element in the tree. */
function getStrip() {
  return screen.getByRole("group");
}

describe("DayCarousel", () => {
  it("renders one chip per day from today to maxDate inclusive", () => {
    renderCarousel({ activeDate: TODAY, onActiveDayChange: vi.fn() });
    // Each chip's accessible name is the localized full-date label
    // (weekday/day/month), which is unique per day in a 7-day window —
    // count buttons inside the scrollable strip specifically, so the two
    // chevrons (also <button>) aren't counted as chips.
    const strip = getStrip();
    const chips = strip.querySelectorAll("button");
    expect(chips).toHaveLength(DAYS.length);
  });

  it("marks only the active day's chip with aria-current=\"date\"", () => {
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange: vi.fn() });
    const strip = getStrip();
    const current = strip.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onActiveDayChange exactly once with the clicked day's date", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: TODAY, onActiveDayChange });
    const strip = getStrip();
    const chips = Array.from(strip.querySelectorAll("button"));
    // Click the 3rd chip (2026-09-06) — not the active one, so a real
    // "day changed" action.
    fireEvent.click(chips[2]);
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-06");
  });

  // `stepByDays` throttles emissions (>= STEP_THROTTLE_MS apart) to survive a
  // held arrow key or a held Enter on a chevron — see DayCarousel's header
  // comment. Two deliberate, separate key presses in a real session are
  // always further apart than that, so this test waits out the throttle
  // window between the two key presses with a real timer (no fake timers
  // needed) to keep asserting two genuinely distinct presses, not a
  // burst that the fix is specifically meant to collapse.
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("LTR (fr): ArrowRight moves to the next day, ArrowLeft to the previous day", async () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange, locale: "fr" });
    const strip = getStrip();

    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).toHaveBeenNthCalledWith(1, "2026-09-07");

    await wait(160);
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(onActiveDayChange).toHaveBeenNthCalledWith(2, "2026-09-05");

    expect(onActiveDayChange).toHaveBeenCalledTimes(2);
  });

  it("RTL (ar): ArrowLeft moves to the next day, ArrowRight to the previous day (reversed)", async () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange, locale: "ar" });
    const strip = getStrip();

    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(onActiveDayChange).toHaveBeenNthCalledWith(1, "2026-09-07");

    await wait(160);
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).toHaveBeenNthCalledWith(2, "2026-09-05");

    expect(onActiveDayChange).toHaveBeenCalledTimes(2);
  });

  it("ignores a repeated (auto-repeat) ArrowRight keydown, and stays throttled until STEP_THROTTLE_MS has passed", async () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange, locale: "fr" });
    const strip = getStrip();

    // A held key: the browser marks every repeat after the first with
    // `repeat: true`. This must never reach onActiveDayChange.
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(strip, { key: "ArrowRight", repeat: true });
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);

    // Even a fresh (non-repeat) press right after is still inside the
    // throttle window and must also be dropped.
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);

    // Once the throttle window has elapsed, a genuine next press goes through.
    await wait(160);
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).toHaveBeenCalledTimes(2);
    expect(onActiveDayChange).toHaveBeenNthCalledWith(2, "2026-09-07");
  });

  it("does not call onActiveDayChange when ArrowLeft is pressed at the lower window edge (LTR)", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: TODAY, onActiveDayChange, locale: "fr" });
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(onActiveDayChange).not.toHaveBeenCalled();
  });

  it("does not call onActiveDayChange when ArrowRight is pressed at the upper window edge (LTR)", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: MAX_DATE, onActiveDayChange, locale: "fr" });
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).not.toHaveBeenCalled();
  });

  it("chevrons carry prevDay/nextDay aria-labels and are disabled at the window edges", () => {
    renderCarousel({ activeDate: TODAY, onActiveDayChange: vi.fn() });
    const prevButton = screen.getByRole("button", { name: fr.Booking.prevDay });
    const nextButton = screen.getByRole("button", { name: fr.Booking.nextDay });
    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();
  });

  it("chevrons are both enabled mid-window and the last chevron disables at maxDate", () => {
    renderCarousel({ activeDate: MAX_DATE, onActiveDayChange: vi.fn() });
    const prevButton = screen.getByRole("button", { name: fr.Booking.prevDay });
    const nextButton = screen.getByRole("button", { name: fr.Booking.nextDay });
    expect(prevButton).not.toBeDisabled();
    expect(nextButton).toBeDisabled();
  });

  it("does not call onActiveDayChange when the strip is scrolled (rate-limit non-regression)", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: TODAY, onActiveDayChange });
    const strip = getStrip();
    fireEvent.scroll(strip, { target: { scrollLeft: 500 } });
    expect(onActiveDayChange).not.toHaveBeenCalled();
  });

  it("activeDate is controlled: the same day stays marked active until the parent re-renders with a new prop", () => {
    const onActiveDayChange = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate={TODAY} onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-05");
    // The component does not manage its own active-day state: without the
    // parent re-rendering with a new `activeDate` prop, TODAY's chip is
    // still the one marked current (the prop hasn't changed yet).
    const stillActiveChips = strip.querySelectorAll('[aria-current="date"]');
    expect(stillActiveChips).toHaveLength(1);
    const chipsBeforeRerender = Array.from(strip.querySelectorAll("button"));
    expect(chipsBeforeRerender[0]).toHaveAttribute("aria-current", "date");

    // Now simulate the parent actually reacting to the callback.
    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate="2026-09-05" onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    const chips = Array.from(strip.querySelectorAll("button"));
    // Chip[1] is 2026-09-05.
    expect(chips[1]).toHaveAttribute("aria-current", "date");
  });

  it("roving tabindex: only the active chip is tabbable (tabIndex 0), the rest are -1", () => {
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange: vi.fn() });
    const strip = getStrip();
    const chips = Array.from(strip.querySelectorAll("button"));
    chips.forEach((chip) => {
      const expected = chip.getAttribute("aria-current") === "date" ? "0" : "-1";
      expect(chip).toHaveAttribute("tabindex", expected);
    });
  });

  it("does not move DOM focus to the active chip on mount", () => {
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange: vi.fn() });
    const strip = getStrip();
    const activeChip = strip.querySelector('[aria-current="date"]');
    // The focus-follows-activeDate effect only fires for a change that
    // originated inside the carousel (arrow key / chevron) — never on the
    // initial mount, or the wizard would steal focus from the patient the
    // moment the "Date & time" step appears.
    expect(document.activeElement).not.toBe(activeChip);
  });

  it("moves DOM focus to the new active chip after a keyboard-driven activeDate change lands", async () => {
    const onActiveDayChange = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate={TODAY} onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate="2026-09-05" onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    const chips = Array.from(strip.querySelectorAll("button"));
    expect(document.activeElement).toBe(chips[1]);
  });

  it("otherDate input rejects a well-formed but out-of-window value instead of forwarding it", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: TODAY, onActiveDayChange });
    const input = screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;

    // "0002-09-04" SATISFIES the `\d{4}-\d{2}-\d{2}` regex — it's the bounds
    // check ([today, maxDate]), not the format check, that rejects it. Kept
    // separate from the genuinely malformed case below (Tour 2 audit: the
    // two were conflated in one test here, leaving the regex branch
    // untested).
    fireEvent.change(input, { target: { value: "0002-09-04" } });
    expect(onActiveDayChange).not.toHaveBeenCalled();

    // Well-formed but outside [today, maxDate] — must not fire either, and
    // the DOM value is forced back to the last accepted date (see
    // DayCarousel's `otherDate` onChange comment) rather than left showing
    // the rejected out-of-window date.
    fireEvent.change(input, { target: { value: "2026-12-25" } });
    expect(onActiveDayChange).not.toHaveBeenCalled();
    expect(input.value).toBe(TODAY);

    // A valid in-window date does go through.
    fireEvent.change(input, { target: { value: "2026-09-08" } });
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-08");
  });

  // Tour 2 audit [CRITIQUE]: the regex/format check never actually exercised
  // the "still typing" case, which is what the format branch exists for.
  it("otherDate input ignores genuinely malformed values (empty or partial) without calling onActiveDayChange", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: TODAY, onActiveDayChange });
    const input = screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;

    // Native <input type="date"> reports "" while a segment is incomplete.
    fireEvent.change(input, { target: { value: "" } });
    expect(onActiveDayChange).not.toHaveBeenCalled();

    // Year typed, month/day not yet — still not a full ISO date.
    fireEvent.change(input, { target: { value: "2026-09" } });
    expect(onActiveDayChange).not.toHaveBeenCalled();
  });

  // Tour 2 audit [CRITIQUE]: this is the core regression test. A held
  // ArrowUp/ArrowDown on the native date-segment spinner fires a `change`
  // per repeat, each with a different, well-formed, in-window value — so
  // neither of the two guards above would ever catch it. Only routing
  // `otherDate`'s onChange through the same `emit()` funnel as the arrow
  // keys and chevrons closes this; before Tour 2, `otherDate` sat outside
  // `stepByDays`'s throttle entirely.
  it("otherDate input: a burst of well-formed in-window changes (spinner auto-repeat) is throttled by emit()", async () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange });
    const input = screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2026-09-07" } });
    fireEvent.change(input, { target: { value: "2026-09-08" } });
    fireEvent.change(input, { target: { value: "2026-09-09" } });
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-07");

    await wait(160);
    fireEvent.change(input, { target: { value: "2026-09-08" } });
    expect(onActiveDayChange).toHaveBeenCalledTimes(2);
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-08");
  });

  // Tour 2 audit: defense-in-depth companion to the throttle above — the
  // browser is told outright not to bother auto-repeating the spinner while
  // a key is held on the input itself.
  it("otherDate input: a repeated (auto-repeat) keydown is prevented", () => {
    renderCarousel({ activeDate: TODAY, onActiveDayChange: vi.fn() });
    const input = screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;
    const notCancelled = fireEvent.keyDown(input, { key: "ArrowUp", repeat: true });
    expect(notCancelled).toBe(false);
  });

  // Tour 2 audit [MAJEUR]: chip clicks and chevrons must go through the same
  // `emit()` funnel as the arrow keys, so a rapid-fire burst of clicks (a
  // mouse "auto-repeat" of sorts, or a script) is bounded the same way.
  it("nextDay chevron clicks funnel through the same throttle as arrow keys", async () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange, locale: "fr" });
    const nextButton = screen.getByRole("button", { name: fr.Booking.nextDay });

    fireEvent.click(nextButton);
    fireEvent.click(nextButton);
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);
    expect(onActiveDayChange).toHaveBeenCalledWith("2026-09-07");

    await wait(160);
    fireEvent.click(nextButton);
    expect(onActiveDayChange).toHaveBeenCalledTimes(2);
  });

  it("Home moves the active day back to today", () => {
    const onActiveDayChange = vi.fn();
    renderCarousel({ activeDate: "2026-09-06", onActiveDayChange });
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "Home" });
    expect(onActiveDayChange).toHaveBeenCalledTimes(1);
    expect(onActiveDayChange).toHaveBeenCalledWith(TODAY);
  });

  // Tour 2 audit [MAJEUR]: `Home` pressed while already on `today` must be a
  // true no-op — including not arming a focus request that would fire on
  // some later, unrelated activeDate change and steal focus out from under
  // the patient (e.g. mid-typing in the otherDate input).
  it("Home while already on today is a no-op and does not steal focus on a later, unrelated activeDate change", () => {
    const onActiveDayChange = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate={TODAY} onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    const strip = getStrip();
    fireEvent.keyDown(strip, { key: "Home" });
    expect(onActiveDayChange).not.toHaveBeenCalled();

    const input = screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Simulate the parent reacting to some unrelated activeDate change (e.g.
    // the otherDate input itself) while focus is still in that input.
    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DayCarousel today={TODAY} maxDate={MAX_DATE} activeDate="2026-09-08" onActiveDayChange={onActiveDayChange} />
      </NextIntlClientProvider>,
    );
    expect(document.activeElement).toBe(input);
  });
});
