// @vitest-environment jsdom
//
// Component test for BookingWizard's slot-loading network layer (Task 6R
// étape 4, Tour de correction 1). DayCarousel.test.tsx already locks down
// DayCarousel in isolation; this file locks down the layer ABOVE it —
// `loadSlots`' trailing debounce, `fetchAndCache`'s in-flight dedup, and
// `runSlotFetch`'s `AbortController` — none of which had a component test
// before this audit found a BLOQUANT hiding in their interaction (see the
// relay file, tour de correction 1). Reuses DayCarousel.test.tsx's
// conventions: real `messages/fr.json` through `NextIntlClientProvider`,
// `Element.prototype.scrollIntoView` stubbed for jsdom.
//
// Fake timers are REQUIRED here: `LOAD_SLOTS_DEBOUNCE_MS` (280ms) has to be
// advanced deterministically to distinguish "still debouncing" from "the
// request actually fired", and the network mock's own artificial delay has
// to be advanceable the same way so an in-flight request can be held open
// across an `activeDate` round trip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { addClinicDays } from "@/lib/time/clinicTime";
import fr from "../../../../messages/fr.json";

// `PatientForm` (step 3, never actually mounted by any test below) imports
// `Link` from `@/i18n/navigation`, which wraps next-intl's `createNavigation`
// — that pulls in `next/navigation` at MODULE LOAD time regardless of
// whether step 3 ever renders. This test's Vite/Vitest module resolver can't
// resolve the bare `next/navigation` specifier that next-intl's ESM build
// imports internally (a pre-existing environment gap, not something this
// audit's diff touches — no test in this repo rendered a `next-intl`
// `Link` consumer before). Stubbing the wrapper is the standard, narrowly
// scoped way around an import-time-only dependency: BookingWizard.tsx and
// PatientForm.tsx themselves are untouched, and no test here ever asserts on
// this `Link`.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
  getPathname: () => "/",
}));

// eslint-disable-next-line import/order -- must come after the vi.mock above
import BookingWizard, { type BookingWizardInitialData } from "./BookingWizard";

const TODAY = "2026-09-04";

const SERVICE: BookingWizardInitialData["services"][number] = {
  id: "s1",
  slug: "consultation",
  name: "Consultation",
  description: "Bilan orthodontique",
  durationMinutes: 30,
  price: 0,
  currency: "DZD",
};

function initialData(maxHorizonDays = 120): BookingWizardInitialData {
  return {
    services: [SERVICE],
    consentVersion: "v1",
    today: TODAY,
    maxHorizonDays,
  };
}

/** A fetch mock for `/api/slots` whose per-call delay is controllable by URL
 *  (so a specific day's request can be held open while other days — e.g.
 *  `prefetchWeek`'s 7-day warm-up — resolve immediately and stay out of the
 *  way). Honours `signal`/`abort()` exactly like the real `fetch`: an
 *  aborted call rejects immediately, synchronously from `abort()`'s own
 *  event dispatch, never waiting out its artificial delay. */
function createSlotsFetchMock(delayForUrl: (url: string) => number = () => 0) {
  return vi.fn((url: string, opts?: RequestInit) => {
    const ms = delayForUrl(url);
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          json: async () => ({ available: [], occupied: [] }),
        } as Response);
      }, ms);
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  });
}

function renderWizard(fetchMock: ReturnType<typeof createSlotsFetchMock>, maxHorizonDays?: number) {
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <BookingWizard initialData={initialData(maxHorizonDays)} />
    </NextIntlClientProvider>,
  );
}

/** Enters step 2 ("Date & time") by picking the only service. Flushes the
 *  microtask/timer queue right after so `prefetchWeek`'s 7 immediate
 *  requests (delay 0 by default) settle before a test starts counting its
 *  own calls. */
async function selectService() {
  const button = screen.getByText(SERVICE.name).closest("button");
  if (!button) throw new Error("service button not found");
  fireEvent.click(button);
  await act(async () => {
    // A small positive advance, not 0: `prefetchWeek`'s zero-delay mocked
    // fetches are scheduled via `setTimeout(fn, 0)`, and a boundary-exact
    // `advanceTimersByTimeAsync(0)` is a needlessly fragile way to ask a fake
    // timer queue to "run everything currently due".
    await vi.advanceTimersByTimeAsync(5);
  });
}

function getOtherDateInput() {
  return screen.getByLabelText(fr.Booking.otherDate) as HTMLInputElement;
}

async function changeDate(value: string) {
  fireEvent.change(getOtherDateInput(), { target: { value } });
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("BookingWizard — slot network layer (debounce + dedup + abort)", () => {
  // (a) Task 6R étape 4 closure condition (MAJEUR 3 / dette de volume): a
  // trailing debounce must cost exactly ONE network request no matter how
  // many days are swept through, as long as each stop is shorter than
  // `LOAD_SLOTS_DEBOUNCE_MS` (280ms).
  it("(a) 91 day changes 40ms apart cost exactly one /api/slots request", async () => {
    const fetchMock = createSlotsFetchMock();
    renderWizard(fetchMock, 150);
    await selectService();
    const baseline = fetchMock.mock.calls.length; // prefetchWeek's 7 calls

    // Sweep 91 distinct days, all outside the 7-day prefetch window, each a
    // cache miss, 40ms apart — well under the 280ms trailing debounce, so it
    // never actually fires mid-sweep.
    for (let i = 0; i < 91; i++) {
      const day = addClinicDays(TODAY, 10 + i);
      await changeDate(day);
      await tick(40);
    }
    // Let the trailing debounce elapse with no further changes.
    await tick(400);

    expect(fetchMock.mock.calls.length - baseline).toBe(1);
  }, 30000); // 91 re-renders of ~91 day chips each (>8k jsdom renders) blow
  // past Vitest's 5000ms default even under fake timers — the fake clock
  // isn't what's slow, the DOM work driving it is. Local timeout only, same
  // convention as tests/integration/*.test.ts's slow-suite overrides; the
  // sweep width (91 days = the real maxHorizonDays=90+1 window) and the
  // assertion are untouched.

  // (b) THE regression test for the BLOQUANT: re-arriving on a day whose
  // earlier request is still in flight must never surface an error banner.
  // Per the audit: this test must FAIL on the pre-fix code (dedup handing
  // back an already-aborted promise) and PASS after it.
  it("(b) day A -> B -> back to A while A's request is still in flight never shows a slots error", async () => {
    const dayA = addClinicDays(TODAY, 20);
    const dayB = addClinicDays(TODAY, 21);
    // Only day A's request is slow (800ms); everything else (prefetch, day
    // B) resolves on the next tick, so timing is driven entirely by day A.
    const fetchMock = createSlotsFetchMock((url) => (url.includes(`date=${dayA}`) ? 800 : 0));
    renderWizard(fetchMock, 60);
    await selectService();

    // Day A: cache miss, schedules the trailing debounce.
    await changeDate(dayA);
    await tick(280); // debounce fires -> first runSlotFetch(A) starts (800ms)

    // Switch away before A resolves...
    await changeDate(dayB);
    await tick(40); // well short of B's own 280ms debounce

    // ...and back to A while the FIRST A request is still in flight. This
    // clears B's pending debounce (it never fires) and reschedules A's.
    await changeDate(dayA);
    await tick(280); // second debounce fires -> aborts the first A request,
    // starts a second one for A

    // At this exact moment the first (now-aborted) request settles to
    // `null`. This is where the BLOQUANT (and the stale-response guard
    // fixed alongside it) matters: neither the reused-promise bug nor the
    // superseded first call may paint an error.
    await tick(5);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Let the second, genuine A request resolve.
    await tick(800);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // (c) selectService must cancel a debounce left pending from the
  // previously selected service, so its eventual fetch (if the timer were
  // left to fire) never lands under the new service.
  it("(c) selecting a new service cancels the previous service's pending debounce", async () => {
    const fetchMock = createSlotsFetchMock();
    const secondService: BookingWizardInitialData["services"][number] = {
      ...SERVICE,
      id: "s2",
      name: "Detartrage",
    };
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <BookingWizard
          initialData={{
            services: [SERVICE, secondService],
            consentVersion: "v1",
            today: TODAY,
            maxHorizonDays: 60,
          }}
        />
      </NextIntlClientProvider>,
    );

    const firstButton = screen.getByText(SERVICE.name).closest("button");
    if (!firstButton) throw new Error("first service button not found");
    fireEvent.click(firstButton);
    await tick(5); // let the first service's prefetchWeek settle
    const afterFirstPrefetch = fetchMock.mock.calls.length;

    // Move to a cache-miss day, arming a pending debounce for service 1...
    const day = addClinicDays(TODAY, 30);
    await changeDate(day);
    // ...then leave before the 280ms debounce fires.
    await tick(50);

    // Back to step 1, select the OTHER service.
    const backButtons = screen.getAllByRole("button", { name: fr.Booking.back });
    fireEvent.click(backButtons[0]);
    const secondButton = screen.getByText(secondService.name).closest("button");
    if (!secondButton) throw new Error("second service button not found");
    fireEvent.click(secondButton);
    await tick(5); // second service's own prefetchWeek settles
    const afterSecondPrefetch = fetchMock.mock.calls.length;

    // If service 1's pending debounce had NOT been cancelled, it would have
    // fired here (280ms after it was armed, i.e. well before now) and added
    // an extra call under service 2's watch. Advancing well past both
    // debounce windows must add no further calls beyond service 2's own
    // prefetch.
    await tick(400);
    expect(fetchMock.mock.calls.length).toBe(afterSecondPrefetch);
    // Sanity: the two prefetches did each cost their own requests (i.e. the
    // assertion above isn't vacuously true because nothing ever fetched).
    expect(afterSecondPrefetch).toBeGreaterThan(afterFirstPrefetch);
  });

  // (d) Tour de correction final (MAJEUR 2): a 409 on submit must not leave
  // the lost slot's day sitting in the cache still marked available —
  // otherwise the patient returns to step 2, sees the exact slot they just
  // failed to book, re-picks it, and gets another 409 forever.
  it("(d) a 409 conflict invalidates and reloads the lost slot's cached day", async () => {
    let slotsCallsForToday = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/slots")) {
        const date = new URLSearchParams(url.split("?")[1]).get("date");
        if (date === TODAY) {
          slotsCallsForToday += 1;
          // First call (prefetchWeek's warm-up): one bookable slot. Second
          // call (the reload this fix triggers after the 409): none — a
          // distinct response, so passing only proves a REAL round trip
          // happened, not a stale cache hit painted twice.
          const body =
            slotsCallsForToday === 1
              ? {
                  available: [
                    { startUTC: `${TODAY}T09:00:00.000Z`, localTime: "09:00" },
                  ],
                  occupied: [],
                }
              : { available: [], occupied: [] };
          return Promise.resolve({ ok: true, json: async () => body } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ available: [], occupied: [] }),
        } as Response);
      }
      if (url.startsWith("/api/appointments")) {
        return Promise.resolve({
          status: 409,
          json: async () => ({ error: { code: "SLOT_CONFLICT" } }),
        } as Response);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const { container } = renderWizard(fetchMock, 30);
    await selectService();

    const slotBtn = screen.getByText("09:00").closest("button");
    if (!slotBtn) throw new Error("slot button not found");
    fireEvent.click(slotBtn); // -> step 3

    fireEvent.change(screen.getByLabelText(fr.Booking.firstName), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByLabelText(fr.Booking.lastName), {
      target: { value: "Patient" },
    });
    fireEvent.change(screen.getByLabelText(fr.Booking.phone), {
      target: { value: "0555000000" },
    });
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(checkboxes[0]); // consent
    fireEvent.click(screen.getByRole("button", { name: fr.Booking.next })); // -> step 4

    fireEvent.click(screen.getByRole("button", { name: fr.Booking.submit }));
    await tick(0); // flush `await fetch(...)`
    await tick(0); // flush `await res.json()` and the 409 branch's own sync work

    // Back on step 2, showing the error, with the lost day's cache entry
    // gone and a fresh (still-loading, then reloaded) fetch under way.
    expect(screen.getByRole("alert")).toHaveTextContent(fr.Booking.errorConflict);

    await tick(280); // trailing debounce fires the reload
    await tick(5); // let the mocked (immediate) fetch settle

    expect(slotsCallsForToday).toBe(2);
    expect(screen.getByText(fr.Booking.noSlots)).toBeInTheDocument();
    expect(screen.queryByText("09:00")).not.toBeInTheDocument();
  });

  // (e) Tour de correction final (MAJEUR 3): `fetchAndCache` is the ONLY
  // writer of `suggestedWatchDates`, and it only runs on a cache MISS.
  // Browsing service 1 (accumulating a zero-availability day), switching to
  // service 2, then back to service 1 must not silently lose that
  // suggestion just because the day is now a cache HIT and nothing calls
  // `fetchAndCache` again to re-add it.
  it("(e) suggestedWatchDates survive a round trip through another service (rebuilt from cache)", async () => {
    const dayX = addClinicDays(TODAY, 30);
    let dayXCallsForService1 = 0;
    const fetchMock = vi.fn((url: string) => {
      if (!url.startsWith("/api/slots")) {
        throw new Error(`unexpected fetch ${url}`);
      }
      const params = new URLSearchParams(url.split("?")[1]);
      const date = params.get("date");
      const svc = params.get("serviceId");
      if (svc === "s1" && date === dayX) {
        dayXCallsForService1 += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ available: [], occupied: [] }),
        } as Response);
      }
      if (svc === "s1" && date === TODAY) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            available: [
              { startUTC: `${TODAY}T09:00:00.000Z`, localTime: "09:00" },
            ],
            occupied: [],
          }),
        } as Response);
      }
      // Service 2, or any other day of service 1: content is irrelevant.
      return Promise.resolve({
        ok: true,
        json: async () => ({ available: [], occupied: [] }),
      } as Response);
    });

    const secondService: BookingWizardInitialData["services"][number] = {
      ...SERVICE,
      id: "s2",
      name: "Detartrage",
    };
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <BookingWizard
          initialData={{
            services: [SERVICE, secondService],
            consentVersion: "v1",
            today: TODAY,
            maxHorizonDays: 60,
          }}
        />
      </NextIntlClientProvider>,
    );

    const fillPatientStepAndAdvance = () => {
      fireEvent.change(screen.getByLabelText(fr.Booking.firstName), {
        target: { value: "Test" },
      });
      fireEvent.change(screen.getByLabelText(fr.Booking.lastName), {
        target: { value: "Patient" },
      });
      fireEvent.change(screen.getByLabelText(fr.Booking.phone), {
        target: { value: "0555000000" },
      });
      // `consent` state survives the round trip back through step 1/2 (only
      // `reset()` clears it) — this helper runs twice in this test, so the
      // checkbox may already be checked the second time; clicking it again
      // would UNCHECK it and fail validation.
      const consentCheckbox = container.querySelectorAll(
        'input[type="checkbox"]',
      )[0] as HTMLInputElement;
      if (!consentCheckbox.checked) fireEvent.click(consentCheckbox);
      fireEvent.click(screen.getByRole("button", { name: fr.Booking.next }));
    };

    // Service 1: browse dayX (zero availability -> feeds
    // suggestedWatchDates), then back to today's bookable slot.
    fireEvent.click(screen.getByText(SERVICE.name).closest("button")!);
    await tick(5); // prefetch settles

    await changeDate(dayX);
    await tick(280); // debounce fires -> genuine fetch for dayX
    await tick(5);
    expect(dayXCallsForService1).toBe(1);

    await changeDate(TODAY); // already cached from prefetch — instant

    const slotBtn = screen.getByText("09:00").closest("button");
    if (!slotBtn) throw new Error("slot button not found");
    fireEvent.click(slotBtn); // -> step 3
    fillPatientStepAndAdvance(); // -> step 4

    expect(screen.getByText(fr.Booking.watchSuggest)).toBeInTheDocument();

    // Back to step 1, switch to service 2, then back to service 1 — a
    // full round trip through another service.
    fireEvent.click(screen.getByRole("button", { name: fr.Booking.back })); // step4 -> step3
    fireEvent.click(screen.getByRole("button", { name: fr.Booking.back })); // step3 -> step2
    fireEvent.click(screen.getByRole("button", { name: fr.Booking.back })); // step2 -> step1
    fireEvent.click(screen.getByText(secondService.name).closest("button")!);
    await tick(5); // service 2's own prefetch settles
    fireEvent.click(screen.getByRole("button", { name: fr.Booking.back })); // step2(svc2) -> step1
    fireEvent.click(screen.getByText(SERVICE.name).closest("button")!);
    await tick(5); // service 1's own prefetch settles — everything a cache hit

    // No new network call for dayX happened on this second visit: if the
    // suggestion is showing again below, it can only have come from the
    // cache scan, not from a fresh `fetchAndCache` write.
    expect(dayXCallsForService1).toBe(1);

    const slotBtn2 = screen.getByText("09:00").closest("button");
    if (!slotBtn2) throw new Error("slot button not found (2nd pass)");
    fireEvent.click(slotBtn2); // -> step 3
    fillPatientStepAndAdvance(); // -> step 4

    expect(screen.getByText(fr.Booking.watchSuggest)).toBeInTheDocument();
  });
});
