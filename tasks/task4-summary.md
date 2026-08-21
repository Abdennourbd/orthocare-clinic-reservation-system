# Task 4 — Slot engine (pure logic) (summary)

The slot engine: pure TypeScript, no DB writes, no auth, no I/O. Built
strictly TDD — failing test first, then implementation, then refactor.
Three commits on the branch: the initial engine (`b1a6e15`), the
review-driven hardening (`6eb9c33`), and the security hardening
(`b734b68`).

## Done + verified (all green)

### Module layout

- **`src/lib/time/clinicTime.ts`** — the only module that knows
  `Africa/Algiers`. Exports `CLINIC_UTC_OFFSET_MINUTES = 60` (no DST,
  single source of truth), `formatOffsetHHmm()`, `getClinicDayBoundsUTC(localDateStr)`
  → `{ startUTC, endUTC }`, `toClinicLocalDateString(utc)`, and
  `getClinicDayOfWeek(localDateStr)`. **Day boundaries are local**:
  `2026-08-25` → `23:00:00Z` of the day before through `22:59:59Z` of
  the day itself (separately documented and tested).
- **`src/lib/slots/workingHours.ts`** — `getWorkingHoursForDay(dateStr, setting)`
  looks up `settingValue[dayOfWeek]` and returns `{ openMinutes,
  closeMinutes } | null`. Includes `parseHHmmToMinutes()` and a strict
  `isValidDayConfig()` validator (rejects non-objects, non-string
  `open/close`, malformed `HH:mm` against `HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/`,
  and `close <= open`). Malformed Setting rows return `null` instead of
  crashing.
- **`src/lib/slots/engine.ts`** — the slot engine itself. Public API:
  - `generateSlots(input: SlotEngineInput): Date[]` — produces the
    candidate start times for a (date, service) pair, applying working
    hours, granularity, lunch break, inter-appointment buffer,
    ScheduleException closures (full-day + partial-day and per-service),
    booking horizon, minimum lead time, and overlap-with-appointments
    checks.
  - `isSlotAvailable(startUTC, endUTC, opts): boolean` — re-checks a
    single `[start, end]` window. Exported specifically so Task 5's
    atomic `bookSlot()` can re-validate inside the transaction without
    re-generating the whole day.
  - Internal helpers `overlaps(aStart, aEnd, bStart, bEnd)`,
    `overlapsAppointment`, `exceptionAppliesToService`,
    `exceptionOverlapsSlot` keep the public surface small.
  - `SlotConfigError` — typed error for invalid numeric config (zero or
    negative granularity / duration / buffer).

### Behavior

- **Single-resource assumption** (v1): appointments with a `resourceId`
  only block the matching chair. A `null` `resourceId` on an existing
  appointment is treated as belonging to the implicit single chair (safe
  default until multi-chair is confirmed with the clinic).
- **Rolling horizon** — `now + maxHorizonDays * 24h`. Calendar-day
  semantics intentionally **not** used; inline note documents how to
  switch if it becomes a product requirement.
- **Lead time and past** — slots whose start is before
  `nowUTC + minLeadTimeMinutes` are never offered. This also
  automatically rejects any date in the past relative to `nowUTC`.
- **Lunch break** — a slot overlaps lunch if its start `< lunchEnd`
  **and** its end `> lunchStart`. Half-open interval, so a slot that
  ends exactly at `lunchStart` is allowed.
- **Buffer** — applied around each existing appointment (`±buffer`),
  so bookings can never be placed within `bufferMinutes` of one another
  on the same resource.
- **Closures (ScheduleException)** — full-day blocks the whole day;
  partial-day uses the exception's `startTime`/`endTime` converted to
  clinic-local minutes-since-midnight; per-service exceptions only
  block the matching service.

### Acceptance criteria (from `tasks/todo.md`) — all met

- [x] `generateSlots(date, service)` returns candidate start times
      inside working hours
- [x] Overlapping active appointments excluded from results
- [x] Handles lunch break, inter-appointment buffer, day boundaries
- [x] Respects `Service.durationMinutes` for slot length
- [x] All times stored/compared in UTC but generated against
      **clinic-local** working hours; tests cover 00:00 and 23:59 local
- [x] Closure dates (full-day and partial-day) removed from availability
- [x] Slots inside the minimum lead time, beyond the maximum horizon,
      or in the past are never offered

## Code review fixes (`6eb9c33`)

Applied to the base implementation after the initial commit. Each fix
was driven by a failing or too-thin test:

- **`isSlotAvailable()` exported** (`engine.ts`) — extracted from the
  loop body so Task 5 can re-check a single `[start, end]` inside its
  transaction without regenerating the day. `generateSlots()` now
  delegates to it for each candidate.
- **`getWorkingHoursForDay` hardened** — no longer casts-and-trusts DB
  content. Strict `isValidDayConfig` validator + malformed rows
  returning `null` instead of crashing or silently yielding zero slots.
  7 new unit tests covering non-object inputs, malformed day entries,
  and `parseHHmmToMinutes` validation.
- **`CLINIC_UTC_OFFSET_MINUTES` centralised** — single source of truth
  for the +60 offset. Duplicate hardcoded `+01:00` literals replaced in
  `getClinicDayBoundsUTC`, `getClinicDayOfWeek`, and the partial-day
  exception math.
- **Test gaps closed** — closed-day Friday returns `[]`, multi-duration
  service (60-min slot still fits), full-day closure stored with the
  clinic-local boundaries the seed actually produces, service-scoped
  exception match/mismatch, `isSlotAvailable` happy-path/overlap/
  exception.
- **`toLocalHHmm` test helper** extracted; duplicated `localTimes`
  mapping replaced.
- **Horizon semantics** documented inline (rolling 24h ×
  `maxHorizonDays`; calendar-day not currently used).
- Dead comment in `engine.test.ts` removed.

## Security hardening (`b734b68`)

The engine is pure logic, so its attack surface is the values it
trusts. A security review found one **High** and one **Medium** issue,
both fixed:

- **[High] Unbounded generation loop — remote DoS** —
  `granularityMinutes === 0` (or `< 0`), or `serviceDurationMinutes < 0`,
  would make the loop never terminate. These values come from admin-
  editable Settings and Service rows, so a typo (or a compromised admin
  account) would have hung every `GET /api/slots` request once Task 6
  wires it. Reproduced in a test: feeding `granularityMinutes: 0` to
  the unfixed engine crashed the Vitest worker process (58 s, "Worker
  exited unexpectedly"). Fixed by adding `SlotConfigError` +
  `assertPositiveInteger`/`assertNonNegativeInteger` guards at the top
  of `generateSlots` and `isSlotAvailable`. Bad values now throw a typed
  error instead of hanging.
- **[Medium] Negative buffer silently disables/inverts the gap** — a
  negative `bufferMinutes` shrunk the blocked window instead of
  expanding it, risking back-to-back double-booking. Fixed with the
  same non-negative guard.
- **[Low] Malformed `localDateString`** — `?date=garbage` silently
  yields `[]`; no crash, no injection. Security test pins "must not
  throw/hang"; Task 6 must validate `YYYY-MM-DD` with Zod at the route.
- **[Low] Malformed `lunchBreak` times** — silently ignored. Security
  test pins "must not throw/hang"; formal `HH:mm` validation left to
  Task 6's Zod boundary.

Adversarial tests live in `src/lib/slots/engine.security.test.ts` (8
cases). The hang-prone cases use a 1.5 s per-test timeout so a
regression fails fast instead of freezing the suite.

## Verification

- `npm run lint` — pass
- `npm run typecheck` — pass
- `npm test` — **65/65 pass** across 9 files:
  - `clientIp` 7, `rateLimit` 6, `phone/normalize` 10, `localized` 6,
    `schema` 2, `clinicTime` 4, `workingHours` 10, `engine` 13
    (generateSlots), `engine.security` 8 (adversarial)
- `npm run build` — pass
- Demonstrated the DoS vulnerability **before** the security fix (worker
  crash, 58 s), and confirmed it's gone **after** (full security suite
  in ~700 ms).
- Sample run on a Tuesday with `workingHours.tue = { open: "10:00",
  close: "17:00" }`, 30-min service, 15-min granularity, 5-min buffer,
  120-min lead time, returns the expected 25 slots starting at the
  first allowed time and respecting the buffer around an existing
  appointment.

## Notes

- **Number of chairs still to confirm with the clinic** before
  multi-resource support is unlocked. The single-resource path is
  safe in the meantime: a `null` `resourceId` on an existing
  appointment is treated as belonging to the implicit single chair.
- The engine does not validate `localDateString`'s `YYYY-MM-DD` shape
  — Task 6's route is expected to do that with Zod (project
  convention). Security tests pin the current behavior.
- The error `SlotConfigError` is exported so the Task 6 route can map
  it to a `500`/`409`-family response without leaking the raw config
  value.
- Commits on the branch: `b1a6e15` (initial) → `6eb9c33` (review) →
  `b734b68` (security hardening).
