# Task 6 — Booking wizard + `POST /api/appointments` + `GET /api/slots`

Vertical slice of the public booking flow, built TDD (failing test → minimal
code → refactor) on top of Tasks 4/5's slot engine and atomic booking. Delivered
per `tasks/todo.md` Task 6 and `tasks/plan.md` (§Public booking, §Abuse
controls, §Waitlist, §Consent, §Timezone).

## Done + verified

### Backend routes

- **`GET /api/services`** + **`GET /api/services/[slug]`** — active services,
  localized via the Task 2 `localized()` helper (`?locale=` param, FR fallback).
  Data layer in `src/lib/public/services.ts` (reused by Task 11's pages).
- **`GET /api/slots?serviceId=&date=`** — `available` (bookable, rendered as
  buttons) + `occupied` (already-reserved, rendered greyed). Both carry
  `startUTC` + clinic-local `localTime` (new `formatClinicLocalTime()` helper),
  so display never depends on the viewer's timezone. Slots blocked only by the
  booking policy (lead time / horizon / past / lunch) appear in neither list.
  Lighter per-IP rate limit (120/min). Unknown service → 404; config/DB errors
  are NOT masked as 404 (typed `ServiceNotFoundError`).
- **`POST /api/appointments`** — the guarded public write path:
  1. **Origin guard** (`isSameSiteOrigin` in `lib/security/origin.ts`): rejects
     cross-site POSTs (403) when `APP_URL` is configured; localhost always
     allowed (dev/test).
  2. **Per-IP rate limit** via `getClientIp()` — trusted proxy headers only, so
     a forged `x-forwarded-for` cannot bypass it (20/hour).
  3. **Zod validation** with the schema shared with the wizard
     (`src/schemas/booking.ts`).
  4. **E.164 phone normalization** (`lib/phone/normalize.ts`) — the per-phone
     limit, the PENDING cap and duplicate detection all key off the normalized
     value.
  5. **Per-phone rate limit** (5/hour) — failed-but-normalized requests still
     consume a token (verified by test).
  6. **Consent version check** — a booking under a stale `consentVersion`
     (≠ current `Setting`) is rejected (400 `STALE_CONSENT`).
  7. **Watch-date validation** against the booking policy (no past dates,
     within horizon, YYYY-MM-DD) — `lib/booking/watchDates.ts`.
  8. **`createBooking()`** — patient upsert + `bookSlot` + optional PATIENT
     `WaitlistEntry` in ONE transaction. Conflict → 409 `SLOT_CONFLICT`;
     PENDING cap → 429 `PENDING_LIMIT`.

### Domain logic

- **`getDaySlotOverview()`** (`lib/slots/engine.ts`) — splits a day's candidate
  slots into `available`/`occupied` using the same single source of truth
  (`isSlotBookable`) as `generateSlots` and the transactional re-check, so the
  rendered grid and the booking re-check can never disagree.
- **`loadDaySlotContext()`** (`lib/booking/loadSlotContext.ts`) — day-level
  engine inputs (settings + closures + active appointments), refactored with a
  shared `loadDayData` used by both the slot-context and the day context.
- **`createBooking()`** (`lib/booking/createBooking.ts`) — takes a **per-phone
  Postgres advisory lock** so concurrent requests from the same phone cannot
  both pass the active-PENDING cap and cannot race the `findFirst`-then-create
  upsert into duplicate patients. `maxActivePending` is enforced authoritatively
  inside the transaction (`PendingLimitError`, concurrency-tested).
- **`lib/booking/policy.ts`** — reads the admin-editable booking policy and the
  current consent version (with documented defaults).

### Frontend — `/book` wizard

- **`/[locale]/book/page.tsx`** (server component, `force-dynamic`) loads
  services, booking policy and consent version fresh per request.
- **`BookingWizard/`** client components: `BookingWizard` (5-step state machine
  + success), `DatePicker` (next-14-days strip + native date input, bounded to
  the booking window), `SlotPicker` (available buttons / reserved disabled
  buttons, full `date, time — available/reserved` aria-labels, `aria-pressed`),
  `PatientForm` (details + consent checkbox + privacy link).
- **Cancellation-watch opt-in** on the summary step: days the patient browsed
  with zero availability are pre-suggested; extra days can be added; sends
  `watchDates` with the booking.
- **"Clinic will call to confirm"** messaging on the summary and success
  screens (the booking is PENDING, not confirmed).
- All strings in `messages/{fr,ar,en}.json` (`Booking` namespace, identical key
  sets across locales); Arabic renders RTL via the existing layout.

## Acceptance criteria → status

| Criterion | Status |
|---|---|
| Slots render as available/reserved correctly | ✅ `getDaySlotOverview` + integration test |
| Booking creates a PENDING appointment via `bookSlot` | ✅ `createBooking` + test |
| Conflict shows a user-facing error (slot just taken) | ✅ 409 → wizard shows `errorConflict`, returns to slot step |
| Summary states the clinic will call to confirm | ✅ summary + success screens, 3 locales |
| Cancellation-watch step: skippable, multi-select, pre-suggests browsed zero-availability days, 3 locales/RTL | ✅ |
| `watchDates` validated (horizon + no past); entry created in the booking transaction (no orphan) | ✅ `validateWatchDates` + rollback test |
| No watch opt-in → no `WaitlistEntry` | ✅ test |
| Consent required; `consentAt` + `consentVersion` stored; privacy linked | ✅ + stale-consent rejection |
| Phone stored normalized (E.164) and as typed | ✅ test (`phoneE164` + `phone`) |
| Rate limits + PENDING cap reject a flood from one IP/phone | ✅ per-phone (failed-request token consumption), per-IP, PENDING cap tests |
| Keyboard-navigable; slot buttons have date+time labels | ✅ buttons + aria-labels + `aria-pressed` |
| Route-level integration tests: happy, conflict, rate-limit, watchDates, invalid watchDates | ✅ `tests/integration/booking-flow.test.ts` + `create-booking.test.ts` |
| Works in 3 locales, RTL for Arabic | ✅ build + curl of `/fr|ar|en/book`, `dir=rtl` |

## Verification

- `npm test` → **133 passing** (16 files: engine, clinic-time, watchDates,
  createBooking, booking-flow integration, plus Tasks 1–5 suites).
- Coverage run confirms the public routes are now near-fully exercised:
  `appointments/route.ts` 93% lines, `slots/route.ts` 89% lines — the two
  branches previously uncovered (malformed-JSON 400 and the slots 429
  rate-limit path) were added as tests in the final testing pass.
- `npm run typecheck` and `npm run lint` clean; `npm run build` succeeds
  (`/[locale]/book` and the 4 API routes are dynamic).
- Manual smoke test against the shared dev DB: services list, slots (open day /
  closed Friday / lead-time filtering), full booking (201 + waitlist created),
  conflict (409), no-consent (400), cross-origin (403), birth-date booking (201).

## Code review

Reviewed by a senior code-reviewer subagent. Findings addressed:

- **Blocker** — `birthDate` used `z.string().datetime()` but the native date
  input yields `YYYY-MM-DD`; switched to `z.string().date()` (+ integration
  test for a filled birth date).
- **Should-fix** — PENDING cap / patient-upsert race under concurrency: added
  a per-phone advisory lock + authoritative in-transaction cap re-count
  (+ `Promise.all` concurrency test → ≤ cap succeed, exactly one patient row).
- **Should-fix** — no origin check on the public POST: added
  `lib/security/origin.ts` (+ cross-origin/same-site tests with `APP_URL` set).
- **Should-fix** — `GET /api/slots` masked every error as 404: typed
  `ServiceNotFoundError`, other errors rethrown.
- **Should-fix** — hardcoded `+01:00` in the wizard: now derives from
  `clinicTime.ts` helpers (single timezone source).
- **Nits** — `watchDates` UI cap (10, matching the schema); catch-all field
  error so an unmapped schema path never fails silently.

### Follow-up review (second pass)

A fresh review of the final code found and fixed two additional items:

- **Returning-patient optional fields were silently wiped on re-booking.**
  `upsertPatient` applied `email ?? null` / `birthDate ?? null` on the update
  branch too, and the wizard always starts blank, so a re-booking by an
  existing phone erased a previously captured email/birthDate. Now those fields
  are only overwritten when actually provided (regression test added).
- **`addDaysClinicLocal` / `noonLocal` duplicated verbatim** in both
  `BookingWizard.tsx` and `DatePicker.tsx`. Extracted as `addClinicDays()` /
  `clinicNoon()` in `lib/time/clinicTime.ts` (the single timezone source) and
  both components import them (unit tests added).

## Notes

- `watchDates` stored as each clinic-local date's UTC midnight
  (`WaitlistEntry.preferredDates`), matching the Task 17 matching rules.
- The privacy page is linked from the consent checkbox but is built in Task 11
  (plan's dependency order).
- `APP_URL` should be set in the deployment env; without it the origin guard is
  permissive (Task 12 ships the strict CSRF layer for admin routes).