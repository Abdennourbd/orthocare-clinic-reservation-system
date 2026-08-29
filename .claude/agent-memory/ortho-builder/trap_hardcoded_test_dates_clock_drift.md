---
name: trap-hardcoded-test-dates-clock-drift
description: Booking integration tests hardcode "2026-08-29" as a bookable date; the sandbox clock advances daily and this silently goes stale, causing unrelated SlotConflictError/409 failures.
metadata:
  type: project
---

Several integration test files (`tests/integration/booking.test.ts`,
`booking-flow.test.ts`, `create-booking.test.ts`, `messaging.test.ts`) hardcode
`localStart("2026-08-29", "11:00")` as their booking slot. `bookSlotInTx`
checks lead time against the REAL wall clock (`new Date()`), not a mocked one.
Once the sandbox's simulated "today" catches up to or passes that date, every
one of these tests starts failing with `SlotConflictError` ("This time slot is
no longer available") or its HTTP 409 mapping — completely unrelated to
whatever you're actually testing.

**Why this matters**: don't waste time debugging these as regressions from
your own diff. **Verify with `git stash` first**: stash your changed files,
rerun the same failing tests against the untouched baseline. If the exact same
failures reproduce on pristine code, it's the clock, not you — report it as a
pre-existing environmental issue and move on, per `CLAUDE.md`'s guidance on
infrastructure problems not being test failures.

**How to apply**: if you add a *new* test to one of these files, don't copy
the hardcoded date. Compute a date relative to `new Date()` instead (e.g. `+5
days`, skip Friday — the fixture's closed day) so your test survives future
clock advances. Task 13 étape 4 tour 2 added a `futureBookableLocalStart()`
helper in `create-booking.test.ts` for exactly this — reuse it if it's still
there rather than re-deriving. Fixing the other files' hardcoded dates
site-wide is out of scope for a single step; flag it as a dedicated ticket
instead of touching files outside your mandate.

**UPDATE — this ticket was filed and fixed (2026-08-29)**: all four files
(`booking.test.ts`, `booking-flow.test.ts`, `create-booking.test.ts`,
`messaging.test.ts`) now import from a new shared module
`tests/integration/helpers/testDates.ts` instead of hardcoding dates.
`futureBookableLocalStart()` moved there and is now **async** (it queries the
`workingHours` Setting row already in the test DB via `getPrisma()`, rather
than hardcoding "skip Friday") — any new caller needs `await`. The module
also exports `nextOpenLocalDate()` / `nextClosedLocalDate()` for tests that
need an explicit open- or closed-day date (e.g. the "rejects a slot on a
closed day" tests), and reuses `addClinicDays`/`getClinicDayOfWeek` from
`@/lib/time/clinicTime` rather than reimplementing weekday arithmetic. If you
add a new booking-integration test file, import from this module first
before writing another local `localStart`/date helper.
