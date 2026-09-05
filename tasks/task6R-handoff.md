# Task 6R — Scrollable Day Carousel for Booking Wizard — Handoff after Steps 1–3

**Status:** Steps 1–3 complete (i18n + DayCarousel component + tests).  
**Remaining steps:** 4, 5 (wire into BookingWizard, human recipe).  
**Tests:** 1131/1131 passing · typecheck clean · lint clean.

---

## ⚠️ CRITICAL POINT: The relay file must be read in full

The file `.claude/tasks/task-6R.md` (1095 lines, contains the detailed plan, three security audits, and all constraints) is **gitignored** (`.gitignore:49`).

**Without external transmission, you will restart from zero at steps 4–5.**

Ask your colleague who delivered the previous task, or have it sent by mail/Slack before starting step 4. The sections this document *cannot* substitute:
- Step 4 **conditions of closure** — 4 MAJOR constraints that block the step from being declared complete (steps 1–3 did not trigger these; step 4 introduces them)
- The full security audit trail (3 rounds on step 2, re-proven by independent auditors)
- Exact constraint wording on input validation and rate-limit interaction

**Read the relay in full before coding.**

---

## Exact Status

### Tasks 6R-1, 6R-2: Complete ✅
- **6R-1 (light background):** `src/app/globals.css` line 4 has `--background: #f8fafc`, no dark-mode override.
- **6R-2 (TimeGrid + mergeSlots):** `src/lib/booking/mergeSlots.ts`, `mergeSlots.test.ts`, and `src/components/public/BookingWizard/TimeGrid.tsx` exist, rendering a chronological grid with reserved slots in red + disabled + aria-labels.

### Task 6R-3: Steps 1–3 Complete ✅

#### Step 1 — i18n keys (DONE)
**Files modified:** `messages/fr.json`, `messages/ar.json`, `messages/en.json`  
**Added:** Lines 227–229 in namespace `Booking`: `dayCarouselLabel`, `prevDay`, `nextDay` (before `SelfService` namespace which starts line 280).

**Verification:**
- ✅ `grep -c '"dayCarouselLabel"' messages/{fr,ar,en}.json` → 1 for each.
- ✅ Namespace placement verified (before SelfService).
- ✅ JSON valid (`node -e JSON.parse`).
- ✅ `git diff --numstat messages/` → 3 files, 3 insertions, 0 deletions (CRLF preserved).
- ✅ `npm run build`, `npm run typecheck`, `npm run lint` all pass.
- **Note (minor, non-blocking):** Arabic text `مفتاحي السهم الأيسر والأيمن` (line 227 of ar.json) is grammatically terse. Alternate forms proposed in the relay for review by an Algerian Arabic speaker if needed — see relay §Étape 1 at end.

#### Step 2 — DayCarousel.tsx component (DONE)
**Files created:**
- `src/components/public/BookingWizard/DayCarousel.tsx` (430 lines, not yet imported anywhere)
- `src/components/public/BookingWizard/DayCarousel.test.tsx` (398 lines, jsdom environment)

**Key facts:**
- Component receives `today`, `maxDate`, `activeDate` (controlled by parent), `onActiveDayChange` callback.
- Renders ~91 chips (all days from `today` to `maxDate` inclusive) in a `scroll-snap` container.
- Keyboard: Arrow Left/Right step through days (direction-aware for RTL Arabic); Home returns to today.
- Chevron buttons (Previous/Next) disabled at window edges.
- CSS pattern `rtl:-scale-x-100` mirrors chevrons in Arabic (no separate RTL logic on clicks).
- `otherDate` input (`<input type="date">`) preserved as escape hatch for far-out dates.
- Rate-limit protection: active day changes **only** on explicit action (click, arrow key, chevron, date input) — never derived from scroll.

**Verification:**
- ✅ `grep -c "snap"` → 4 (snap-x/snap-mandatory/snap-start).
- ✅ `grep -c "rtl:-scale-x-100"` → 3.
- ✅ `grep -c "aria-current"` → 1.
- ✅ No new npm dependencies (`git diff package.json` empty).
- ✅ `npm run typecheck`, `npm run lint` clean.

#### Step 3 — Component tests (DONE)
**File created:** `src/components/public/BookingWizard/DayCarousel.test.tsx`

**22 tests verified** (before: 1109 tests; after: 1120 tests):
1. Renders one chip per day from today to maxDate.
2. aria-current="date" marks only active day.
3. Click on chip calls onActiveDayChange once.
4. LTR (fr): ArrowRight → next day, ArrowLeft → previous day.
5. RTL (ar): ArrowLeft → next day, ArrowRight → previous day (reversed).
6–7. Boundary tests (ArrowLeft at lower edge, ArrowRight at upper edge → no call).
8–9. Chevron disabled states and aria-labels.
10. Non-regression: scroll event alone does **not** call onActiveDayChange (protects rate-limit).
11–16. Roving tabindex, focus management, otherDate input validation, throttle behavior.
17–22. Additional tests covering edge cases and focus interaction.

**Verification:**
- ✅ `npm test` → 1131 tests passing, 0 failures.
- ✅ `npm run typecheck`, `npm run lint` clean.
- ✅ Integration tests `booking-flow.test.ts`, `create-booking.test.ts` pass **unmodified**.
- ✅ DayCarousel.tsx **not imported anywhere** (still in dépôt, not wired yet).

---

## THE CORE LESSON — Why Steps 1–3 Required Three Correction Rounds

The rate-limit constraint **is the structuring force.** `GET /api/slots` caps at **120 requests/minute/IP** (`src/app/api/slots/route.ts:43`). Each newly-displayed day costs one request on the parent. The carousel covers ~91 days. **Three successive defects of the same family** were discovered, each re-opening the flaw by a different door:

1. **Auto-repeat of keyboard key** (`e.repeat` not tested) — holding down an arrow key fires multiple keydown events synchronously.
2. **Enter held on a chevron** — a `<button>` emits one click per auto-repeat frame, hence throttling was added.
3. **`otherDate` field outside throttle guard** — it lives in a `<div>` sibling to the keyboard-listening container, so its `onChange` callback escaped the rate-limit barrier.

**The crucial lesson, in bold:**  
*The guard belongs to the emission, not to the stepping function.* 

The final solution is a **single funnel `emit()`** (DayCarousel.tsx:233). `onActiveDayChange` now has **exactly one executable call site.** All four emitters pass through it: `stepByDays` `:244`, `Home` `:263`, chip click `:327`, `otherDate` `:423`. The throttle and equality guard live at `:229-231`, protecting all four paths at once.

Contrast: Step 2 Tour 1 tried to throttle in `stepByDays` only, leaving `otherDate` unguarded. Tour 2 tried a separate guard in `otherDate`'s onChange. Tour 3 unified them. **This is the pattern a repreneur must not lose: one emission funnel, one guard.**

---

## ⚠️ CONDITIONS OF CLOSURE FOR STEP 4 — MUST BE TREATED

**Step 4 cannot be declared complete without addressing these.** These are MAJOR constraints extracted from the security audit trail. Without them, the verdict on security would have been **ORANGE**, not GREEN.

### MAJOR 1 — Keyboard input segmentation (lines 419–421 of DayCarousel.tsx)

**The problem:** Forcing `e.target.value` on *every* `change` event breaks character-by-character keyboard input.

A native `<input type="date">` emits `change` as soon as a segment is complete. **Intermediate states are out-of-window:** tapping month `11` produces first `2026-01-04` (< today) → field resets on first keystroke → second keystroke never arrives.

**The fix:** Move the `e.target.value` force from `onChange` to `onBlur` (or equivalently, `if (document.activeElement !== e.target)`). The throttle in `emit()` `:230` already blocks back-to-back valid values; the bornes check needs to act only when input is truly complete, not mid-edit.

**Verification:** ⚠️ **Confirm by eye at step 5 first** — jsdom does not model segment-by-segment editing. Test: open `/fr/book`, type "25" in the day segment. If the field does **not** reset after the first keystroke, this drops to MINOR.

### MAJOR 2 — Throttled value creates display/action mismatch (lines 423 → 230)

**The problem:** When throttle *discards* a valid value, the browser has already advanced the DOM display, but nothing re-renders — the field shows a date for which no carousel chip is marked active.

**Impact (verified as bounded):** The reserved date comes from `activeDate` (BookingWizard.tsx:292), the grid is labeled from `activeDate` (`:603`) → **impossible to reserve the wrong day.** It is a contradictory display, not data integrity failure.

**The fix:** Re-sync the input's displayed value on the discarded-by-throttle path, **and add the missing `input.value` assertion** to the burst test (`:316-331`). Currently the test counts calls but never asserts the input's final value. Add: `expect(input.value).toBe(string(activeDate))` or similar, confirming the field visually matches the carousel state after throttle expires.

### MAJOR 3 — Throttle leading-edge loses a deliberate press + volume budget exceeded

**The problem (two-part):**

1. **Leading-edge throttle on emit `:229-231`** eats one deliberate keystroke. Component is controlled, no local state to catch it.  
2. **Volume budget real breach:** The true rate-limit overshoot comes from `slotsCache.current = new Map()` (BookingWizard.tsx:266 and :454) — vidying cache on service change. Two services compared in one minute = ~182 requests > 120/min.

**The fix (must be done together):**

In `BookingWizard.tsx`, replace the leading-edge throttle on `loadSlots` with a **trailing debounce** (~250–300 ms) + **request deduplication in-flight** + **AbortController**. A trailing debounce costs ONE request per carousel sweep (user browses all 91 days in ~13 seconds). Leading throttle costs one per chip (~91 requests if user is thorough).

**Once debounce is in place, REMOVE the throttle from `emit()` `:229-231`** in DayCarousel.tsx. Otherwise the deliberate pressure loss remains permanent even though its justification (preventing burst) has been moved upstream and solved better.

**Critical note:** Persist this constraint in code comments. No future developer should "optimize" by re-adding throttle here without understanding that debounce exists at the parent level now.

### MAJOR 4 — Test assertion gap (line 316–331, existing test)

The test that exercises the burst scenario (spinner auto-repeat on `otherDate`) counts the number of `onActiveDayChange` calls but never checks that the input field's displayed value matches the carousel state afterward. Add an assertion: `expect(input.value).toBe(formatISO(activeDate))` or equivalent, to lock in MAJOR 2's fix.

### Minor debts for the same pass

1. **Dead CSS** `:294` — `focus-visible:*` on the non-focusable `role="group"` container. Remove it.
2. **Direct chip click throttle variance** — Two clicks < 150 ms on two **different** days now both get throttled (side effect of unified `emit()`). Either exempt direct clicks or lock in with a test of two distinct targets (current test `:346-359` only tests the same target twice). **Signaled, not a blocker.**
3. **Hook extraction** — `useRovingDayEmitter` grouping `emit`/`stepByDays`/the two refs would simplify the 430-line file. Only if step 4 touches the file in depth; don't extract for its own sake.

---

## THE REPOSITORY'S GOTCHAS — Essential for a third-party repreneur

### ⚠️ CRLF (Windows). Never `sed -i` or `npx prisma format`
Files are in CRLF and tracked by git. `sed -i` under Git Bash rewrites the entire file to LF and explodes the diff. **This has happened twice.** Use the `Edit` tool for targeted changes. **`npx prisma format` is forbidden** (same effect on schema.prisma).

**Proof of line-ending corruption:** `git diff --numstat <file>` on a touch-only change; if it shows deletions on an insertion, line endings were rewritten.

### ⚠️ `plan.md` line 685 is STALE
It claims « no DOM/component test framework is configured. » **This is false.** `tests/setupComponent.ts` exists with `@testing-library/react` + `jsdom` since Task 13. A repreneur who believes this will skip step 3 entirely, declaring it impossible. It is not.

### ⚠️ Never modify `tests/setup.ts`
Absolute rule (CLAUDE.md). It is the guard rail that prevents `TRUNCATE` from reaching the Neon production database. `PatientDocument` is covered by `TRUNCATE ... CASCADE` on `"Patient"` without modifying this file — proof by structural dependency. Same applies here: do not touch this file.

### ⚠️ No new npm dependencies
This task uses CSS `scroll-snap` (native) and plain JavaScript. Do not add `embla-carousel`, `swiper`, `framer-motion`, or any scroll library. `npm install` is forbidden in this task.

### ⚠️ Next.js 16: `params`, `searchParams`, `cookies()`, `headers()` are Promises
Always `await` them. Missed await = no compiler error, silent failure. This is less relevant to step 4 (client-side component), but keep it in mind if you touch BookingWizard.

---

## STEP 4: Wire DayCarousel into BookingWizard and remove DayPicker

### What to do

1. **In `BookingWizard.tsx` line ~15:**  
   Replace `import DayPicker from "./DayPicker";` with `import DayCarousel from "./DayCarousel";`

2. **In the `{step === 2 && (...)}` block (lines ~567–614):**  
   Replace the `<DayPicker ...>` element with:
   ```tsx
   <DayCarousel
     today={today}
     maxDate={maxDate}
     activeDate={activeDate}
     onActiveDayChange={onActiveDateChange}
   />
   ```
   The `<TimeGrid>` stays right below it in the same `<section>`.

3. **Leave unchanged:** `slotsCache`, `fetchAndCache`, `loadSlots`, `prefetchWeek`, `activeDateRef`, `serviceIdRef`, `selectSlot`, `suggestedWatchDates`, conflict handling (409), and the success screen.

4. **Treat the MAJOR constraints above first** (MAJOR 1, 2, 3, 4). **Step 4 cannot close without them.**

5. **Delete `src/components/public/BookingWizard/DayPicker.tsx`.**

6. **Verify no dead imports:**  
   `grep -rn "DayPicker" src/ tests/` must return nothing.

7. **Use the `Edit` tool only** (not `sed -i`, not rewrites).

### Acceptance criteria

- ✅ `grep -rn "DayPicker"` → no results.
- ✅ `grep -n "DayCarousel"` in BookingWizard.tsx → import and usage in step 2 block.
- ✅ `git diff --stat src/components/public/BookingWizard/BookingWizard.tsx` → short diff (handful of lines, not hundreds). Long diff = CRLF corruption, undo and redo with `Edit`.
- ✅ `git diff src/app/api/ src/lib/booking/ prisma/` → **empty** (no backend changes).
- ✅ `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- ✅ `npm test` passes, including `booking-flow.test.ts` and `create-booking.test.ts` **unmodified**.
- ✅ Manual check: `/fr/book` → service select → step 2 shows carousel + grid below → click another day → grid updates in same step → click a slot → advance to patient info.
- ✅ `StepIndicator` displays **4 steps** (no regression).

### Security check (step 4 specific)

- ✅ `GET /api/slots` URL contains only `serviceId`, `date`, `locale` — never patient name, phone, or email.
- ✅ Pre-suggestion of cancellation watch (`suggestedWatchDates` in `fetchAndCache`) still works.
- ✅ 409 conflict redirects back to step 2 (Date & time).
- ✅ No debug `console.log` of patient state left in BookingWizard.tsx.
- ✅ No new `logAction()` calls (patient data logging stays in the API route, not duplicated on client).
- ✅ **No new lines in `tests/authz-matrix.test.ts`** (no new endpoints added).

→ **Mandatory security review (`ortho-security`) on this step.**

---

## STEP 5: Human Recipe — Swipe, RTL, Keyboard, 3 Languages

**⚠️ Mandatory human validation. No agent can check this step by reading code alone.** jsdom has no rendering engine: real scroll, snap, swipe, and RTL direction are not observable by tests. An agent who claims "verified" here without human eyeballs on the screen is lying.

### What to do

Launch `npm run dev`, then run through the checklist:

1. **Touch swipe** (`/fr/book`, mobile mode): Drag the carousel with your finger → scrolls with inertia and **snaps** to a chip edge, never half-way between.
2. **Trackpad/wheel** (desktop): Horizontal scroll works and snaps the same way.
3. **Keyboard only, end-to-end:** Tab to the carousel → Arrow Left/Right change days → Tab to a slot → Enter to select → advance to patient info. **Focus ring visible at each step** (teal outline).
4. **Accessible day indicator (no color alone):** Squint or convert to grayscale → active day still identifiable (border, weight), not just teal.
5. **Arabic RTL** (`/ar/book`): Carousel starts on the **right**, scroll direction correct, **chevrons reversed** (next points left), Arabic text renders (no bare key like `dayCarouselLabel`).
6. **Arrow keys in Arabic** (`/ar/book`): Left arrow advances in time, right arrow rewinds (consistent with RTL reading).
7. **English** (`/en/book`): Same UI, English text, nothing truncated.
8. **Light background** (6R-1 check): OS dark mode → reload `/fr/book` → page stays **light**, not quasi-black.
9. **Reserved slots** (6R-2 check): On a day with bookings, occupied times appear in **red, struck-through, labeled "Reserved", and not clickable**, in their chronological position.
10. **No-slot day:** `noSlots` message displays, UI does not break.
11. **Far-out dates:** `<input type="date">` "Another date" still works, scrolls carousel to that day.
12. **Full real booking** in FR, then AR: Through to success screen with appointment reference.
13. **Build and test suite:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — all four green.

### Security during step 5 (human recipe)

- Use **synthetic test data only** (never real patient names, phones, or birthdates).
- **Check the Network tab:** `GET /api/slots` must carry only `serviceId`, `date`, `locale` — never patient data in URL.
- **No screenshots of real data** in any report.

---

## Key Paths and Files

| Path | Content |
|---|---|
| `messages/{fr,ar,en}.json:227-229` | i18n keys `dayCarouselLabel`, `prevDay`, `nextDay` |
| `src/components/public/BookingWizard/DayCarousel.tsx` | Main carousel component (430 lines) |
| `src/components/public/BookingWizard/DayCarousel.test.tsx` | 22 component tests (jsdom) |
| `src/components/public/BookingWizard/DayPicker.tsx` | To delete (step 4) |
| `src/components/public/BookingWizard/BookingWizard.tsx` | To modify (step 4): import + render DayCarousel |
| `src/components/public/BookingWizard/TimeGrid.tsx` | Stays as-is (already correct) |
| `.claude/tasks/task-6R.md` | Full relay file (1095 lines, **must read**) |
| `src/app/api/slots/route.ts:43` | Rate-limit: 120 req/min/IP |
| `src/lib/booking/policy.ts` | `maxHorizonDays` setting (default 90) |
| `tests/setupComponent.ts` | Component test environment (@testing-library/react + jsdom) |

---

## Summary for a Non-Technical Partner

**Task 6R = Replace the fixed 7-day booking calendar with a scrollable strip that works on phones, works with keyboard, and supports Arabic right-to-left.**

**Delivered (Steps 1–3):**
- Text labels added to French, Arabic, English versions.
- New carousel component built, tested with 22 automated checks.
- All tests passing (1131 total).

**Before you (Step 4):**
- Plug the carousel into the booking wizard.
- Remove the old calendar component.
- Fix 4 known issues (input field, display sync, rate-limit handling, test coverage).

**Your job (Step 5):**
- Grab a phone or browser mobile mode.
- Swipe, tap, use arrow keys, type dates, pick a time slot, complete a fake booking.
- Switch to Arabic and French and repeat.
- Confirm the page stays light (not dark), scroll snaps to days, and keyboard alone works.

If everything looks right on screen, it ships. If you find a problem, tell the developer to go back to Step 4 and fix the code.
