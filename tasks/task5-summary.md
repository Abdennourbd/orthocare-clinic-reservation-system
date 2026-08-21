# Task 5 — Atomic booking + `releaseSlot()` (summary)

Transactional booking, the shared cancellation path, the slot-freed event
bus, and atomic rescheduling. Built strictly TDD (failing test → minimal
code → refactor) on top of Task 4's engine. Delivered per `tasks/todo.md`
Task 5 and `tasks/plan.md` §Code Structure #5.

## Done + verified (all green)

### New files (`src/lib/booking/`)

- **`errors.ts`** — typed booking errors, each with a stable `name` so route
  handlers map to a status without string-matching (mirrors
  `SlotConfigError`/`RateLimitError`):
  - `SlotConflictError` → HTTP 409 (slot just taken / violates policy).
  - `AppointmentNotFoundError` → HTTP 404.
  - `AppointmentAlreadyReleasedError` → HTTP 409 (idempotency guard).
- **`events.ts`** — minimal typed in-process `slot-freed` bus:
  `onSlotFreed(handler)` (returns an unsubscribe) + `emitSlotFreed(event)`.
  No waitlist subscriber yet (Task 17 subscribes).
- **`loadSlotContext.ts`** — the DB reads the pure engine deliberately
  avoids: the service (for duration), the `workingHours`/`slotConfig`/
  `bookingPolicy` Settings, the `ScheduleException`s overlapping the day,
  and the **active** appointments (PENDING/CONFIRMED) overlapping the day.
  Returns a `SlotBookabilityInput` ready for `isSlotBookable`.
- **`bookSlot.ts`** — `bookSlot(input)` + `bookSlotInTx(input, tx)`.
- **`releaseSlot.ts`** — `releaseSlot(id, reason)` + `releaseSlotInTx(...)`.
- **`rescheduleSlot.ts`** — `rescheduleSlot(input)`.

### Concurrency model — Postgres advisory lock

`bookSlot` runs inside a `$transaction`. It takes a **transaction-level
advisory lock** keyed on `(resourceId ?? 'single', clinic-local-day)` via
`SELECT CAST(pg_advisory_xact_lock(hashtext(...)) AS text)`. This serializes
all bookings for the same chair on the same day, so concurrent transactions
for the same slot run one-at-a-time. Inside the lock the window is re-checked
against the *current* DB state through `isSlotBookable` and then inserted.

Because the lock makes concurrent bookings run serially, the re-check is
race-free: of N concurrent bookings for the same slot, exactly one wins and
the rest throw `SlotConflictError`. No retry loop needed (the plan's
"retry on race" is satisfied structurally, not by looping).

**Why not** `SERIALIZABLE + retry` (needs an error-mapping retry loop, harder
to test deterministically) or a GiST `EXCLUDE` constraint (can't express the
inter-appointment buffer cleanly; nullable `resourceId` needs `COALESCE` + a
migration). The advisory lock keeps it simple and correct for the v1
single-chair assumption.

### `bookSlot` flow

```
$transaction:
  advisory_lock(resource ?? 'single', localDay)
  { service, bookability } = loadSlotContext(tx, ...)
  endTime = startUTC + service.durationMinutes        // endTime from duration
  if (!isSlotBookable(startUTC, endTime, bookability)) throw SlotConflictError()
  create Appointment (PENDING, source, resourceId)
```

### `releaseSlot` flow

```
$transaction:
  load appointment; throw AppointmentNotFoundError if missing
  if status not PENDING/CONFIRMED → throw AppointmentAlreadyReleasedError
  update → status=CANCELLED, cancelReason=reason, cancelledAt=now
after commit: emitSlotFreed({ appointmentId, resourceId, startTime, endTime })
```

Emit happens **after** commit so subscribers never see a slot-freed event for
a failed release. Every cancellation path (staff Task 14, self-service Task 8,
auto-expiry Task 9, reschedule) routes through this.

### `rescheduleSlot` — atomic release + book

One `$transaction`: `releaseSlotInTx(old, STAFF, RESCHEDULED, tx)` then
`bookSlotInTx(new, tx)`, then `emitSlotFreed` for the old. Failure rolls back
both — the old appointment is never left released if the new booking fails.

### Engine refactor (single source of truth)

Extracted **`isSlotBookable(startUTC, endUTC, input)`** in `src/lib/slots/
engine.ts` that folds the *policy* (working-hours window, lunch break, lead
time, horizon, past) **+** the existing `isSlotAvailable` (overlap, closures)
into one predicate. `generateSlots` now delegates to it, so the offered slot
list and the `bookSlot` re-check can never disagree. Added `SlotBookabilityInput`
type (`SlotEngineInput` minus `granularityMinutes`).

## Acceptance criteria (from `tasks/todo.md`) — all met

- [x] Two concurrent bookings of same slot → exactly one succeeds
- [x] Conflict returns a clear, typed error (not a crash)
- [x] endTime computed from service duration
- [x] `releaseSlot()` frees the slot and emits slot-freed event (verifiable in test)
- [x] `releaseSlot()` records a `cancelReason` (`STAFF` | `PATIENT_SELF_SERVICE` | `AUTO_EXPIRED` | `CLOSURE`)
- [x] Reschedule = releaseSlot + bookSlot atomically

## Code review fixes (applied after first review)

A self-review of Task 5 found one Critical and several Important issues,
all fixed and re-verified:

- **[Critical] `rescheduleSlot` emitted `slot-freed` *inside* the transaction
  (before commit)** — contradicting its own comment. On a commit failure
  subscribers would have been notified of a slot that was never actually
  freed. Moved the emit to *after* `$transaction` resolves, matching
  `releaseSlot`.
- **[Important] `releaseSlotInTx` TOCTOU race** — `findUnique`-then-`update`
  was not atomic; two concurrent releases of the same appointment both passed
  the guard and both emitted. Replaced with a conditional `updateMany`
  (WHERE `status IN (PENDING, CONFIRMED)`) + count check, so exactly one
  release wins and the loser gets `AppointmentAlreadyReleasedError`.
- **[Important] `loadSlotContext` ignored the buffer at the day boundary** —
  appointments within `bufferMinutes` of midnight (previous/next day) weren't
  fetched, so their buffered overlap was unenforced. Now reads `bufferMinutes`
  first and expands the appointment fetch window by ±buffer.
- **[Important] `loadSlotContext` used `Promise.all` on a single transaction
  connection** — triggered the `pg` "client.query() while already executing"
  deprecation (would break on `pg@9`) and couldn't parallelize anyway.
  Replaced with sequential awaits; the warning is gone.
- **[Important] `rescheduleSlot` hardcoded `cancelReason = STAFF`** — a
  self-service reschedule (Task 8) would be mis-recorded. Added a `reason`
  parameter to `RescheduleSlotInput`.

New/updated tests: reschedule rollback (new slot taken → old stays `PENDING`,
throws), reschedule emits `slot-freed` + records the passed reason, and
`bookSlot` lead-time re-check against the real clock (`minLeadTimeMinutes`
set huge so a stale client can't bypass).

## Verification

- `npm run lint` — pass
- `npm run typecheck` — pass
- `npm test` — **89/89 pass across 12 files** (was 65 before Task 5; +8
  `isSlotBookable`, +5 errors/events, +11 booking integration)
- `npm run build` — pass (`/fr`, `/ar`, `/en` static + `/api/cron/cleanup`)
- Concurrency test: `Promise.allSettled([bookSlot(A), bookSlot(A)])` →
  exactly one fulfilled + one `SlotConflictError`, and only one row inserted.
- The `pg` deprecation warning observed during the first pass is gone after
  serializing `loadSlotContext`'s queries.

## Notes

- **Number of chairs still to confirm with the clinic** before multi-resource
  is unlocked. The lock key and `resourceId ?? 'single'` default are already
  structured for it.
- `releaseSlot` currently takes no `actorUserId` — audit (`logAction`) is
  Task 12; the signature will gain actor info there.
- `clinicTimezone` is still loaded/passed but unread by the engine (inherited
  from Task 4) — flagged as a follow-up; the engine deliberately uses the
  single `CLINIC_UTC_OFFSET_MINUTES` constant.
- **Not committed/pushed** — awaiting the user's go-ahead.
