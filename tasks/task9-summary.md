# Task 9 — Reminders + no-show follow-up + PENDING expiry cron

Delivered per `tasks/todo.md` Task 9 and `tasks/plan.md` (§Cron, §Scheduling,
§Uptime & delivery monitoring). Built on Task 5's `releaseSlot()` and Task 7's
messaging dispatcher; uses the mock provider (real wiring is Task 22).

## What was delivered

### Domain (`src/lib/cron/` — thin routes call these, per plan.md Code Structure)

- `reminders.ts` — `sendReminders(nowUTC?)`: CONFIRMED appointments whose start
  falls in `[now, now+24h)` and whose `reminderSentAt` is still null get the
  REMINDER SMS. `reminderSentAt` is set **only when the message actually went
  out (SENT)** — a provider failure leaves it null so the next run re-attempts
  the same row (the dispatcher retries a FAILED row), so a transient outage can
  never mean "the patient never gets reminded".
- `noShow.ts` — `markNoShows(nowUTC?)`: CONFIRMED appointments whose window has
  fully passed (`endTime < now`) are transitioned to NO_SHOW with `noShowAt`
  set, the NO_SHOW follow-up SMS is sent (non-transactional → `messagingOptOut`
  respected), staff get a NO_SHOW_ALERT notification, and the change is audited
  as `APPOINTMENT_NO_SHOW`. The `updateMany ... WHERE status = CONFIRMED` guard
  makes a concurrent cancel/reschedule or a re-run a no-op.
- `expirePending.ts` — `expirePendingBookings(nowUTC?)`: PENDING bookings past
  `pendingExpiryHours` (read from the `bookingPolicy` Setting) **or** whose
  start time has already passed are cancelled through the shared
  `releaseSlot(id, AUTO_EXPIRED)` — so the slot returns to availability, the
  `slot-freed` event fires (the Task 17 waitlist subscriber is triggered like
  any other cancellation), the patient gets the EXPIRED SMS, staff get a
  PENDING_EXPIRED notification, and the change is audited as
  `APPOINTMENT_AUTO_CANCELLED`. `releaseSlot`'s active-only guard makes re-runs
  safe.

### Routes

- `GET /api/cron/reminders` — `{ ok, sent }`.
- `GET /api/cron/no-show-followup` — `{ ok, marked }`.
- `GET /api/cron/expire-pending` — `{ ok, expired }`.
- `GET /api/health` — uptime probe; 200 `{ ok: true, db: "up" }` when the app
  **and** the database are reachable, 503 otherwise (a probe that only proves
  the process is up misses a dead DB).
- All cron routes authenticate with the `x-cron-secret` header vs
  `CRON_SECRET` (401 without it). The shared check now lives in
  `lib/security/cronAuth.ts`; `/api/cron/cleanup` was refactored onto it so all
  four jobs behave identically.

### Supporting changes

- `lib/messaging/templates.ts` + `prisma/seed.ts` — `reminder`, `noShow`,
  `expired` template keys (French, matching the Task 7 decision) with built-in
  defaults; the seed now carries them too.
- `lib/messaging/notifications.ts` — refactored the four fan-out helpers
  (NEW_BOOKING, CANCELLATION, new NO_SHOW_ALERT, new PENDING_EXPIRED) onto one
  `fanOut()`; payload types for the two new notification types.
- `lib/messaging/format.ts` — `localParts()` extracted from
  `appointmentChanges.ts` and now shared by all message senders (Task 8 + Task
  9) so every template renders the same clinic-local time.
- `lib/audit/logAction.ts` — exported `SYSTEM_ACTOR` for the cron jobs.
- `vercel.json` — the four cron schedules (UTC, with the intended clinic-local
  hour beside each in `plan.md`):
  reminders `0 8 * * *` (09:00 local), no-show `0 17 * * *` (18:00 local),
  expire-pending hourly `0 * * * *`, cleanup `0 3 * * *` (04:00 local).
- `scripts/cron-dry-run.ts` — run the three jobs against the seeded dev DB and
  print what the mock provider logged.

## Idempotency (the acceptance criterion that matters most)

Every job sends **at most one** message per appointment even when run twice:

| Job | Guard 1 (query) | Guard 2 (write) |
|---|---|---|
| reminders | `reminderSentAt = null` | unique `(appointmentId, type)` index |
| no-show | only matches `CONFIRMED` | `updateMany WHERE status = CONFIRMED` + unique index |
| expire-pending | only matches `PENDING` | `releaseSlot` active-only guard + unique index |

Tests lock this with a double-run for each job; the live dry-run confirmed it
too (run 1: 1 reminder + 3 expiries; run 2: 0/0/0).

## Verification

- `npm test -- cron` → **19 passing** (route auth ×3 routes incl. no-secret /
  wrong-secret / unset-CRON_SECRET, positive route; reminders window +
  idempotency + provider-failure retry; no-show marking + opt-out +
  idempotency; expiry via releaseSlot incl. slot-freed event assertion +
  past-start + fresh untouched + CONFIRMED untouched + idempotency; health).
- Full suite `npm test` → **226 passing** (26 files) — was 207 before Task 9.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean; the new
  routes appear in the build output.
- **Live dry-run** against the seeded dev DB (`scripts/cron-dry-run.ts`, mock
  provider): sent 1 reminder, auto-cancelled stale PENDING bookings, logged the
  mock SMS rows; a second run sent nothing.

## Decisions / deviations (recorded per plan.md practice)

1. **Reminders are audited as `SMS_SENT`** with detail
   `{ messageType: "REMINDER" }` — the plan's `AuditAction` enum has no
   `REMINDER_SENT`, and adding one would need a migration for an action already
   representable as `SMS_SENT`. No-show (`APPOINTMENT_NO_SHOW`) and expiry
   (`APPOINTMENT_AUTO_CANCELLED`) use their dedicated actions. All three use
   actor `SYSTEM`, `userId = null`.
2. **`reminderSentAt` set only on SENT.** This is a deliberate strengthening of
   the plan's wording: it converts the dispatcher's existing FAILED-row retry
   into a *cron-level* retry guarantee — a reminder that failed to send stays
   pending and is re-attempted on the next run, while exactly-once for
   successfully sent rows is unchanged.
3. **No-show only fires for CONFIRMED appointments.** PENDING appointments past
   their time are the expiry cron's job (they expire as `AUTO_EXPIRED`), so the
   two jobs are disjoint and nothing double-processes a row.
4. **Expiry condition = `createdAt ≤ now − pendingExpiryHours` OR
   `startTime ≤ now`** — the second clause implements "always before the
   appointment starts" as a guard so a PENDING booking can never survive into
   its own window even when `pendingExpiryHours` hasn't elapsed.

## Notes / deferred

- **Task 22** wires the real provider; these routes need no changes (the
  dispatcher selects the provider from env).
- **Task 17** (waitlist) subscribes to the `slot-freed` event that the expiry
  path emits through `releaseSlot()` — already verified in a test here that the
  event fires with the freed appointment's `serviceId`.
- **`/api/health` has no auth by design** (uptime probes can't carry secrets);
  it returns no data.
- **`CRON_SECRET` is empty in `.env` by default**, so cron routes are locked
  (401) in dev until an operator sets it — the safe default.
- Cron schedules are in `vercel.json`; the operator-facing "what runs when"
  table with clinic-local hours is in `plan.md` §Cron.
- **Ops note:** Vercel's Hobby plan allows only 2 cron jobs; the 4 schedules
  here (plus the hourly expire-pending cadence) require the Pro plan.

## Post-review fixes (code review of this task)

- **Reminder status re-check before send.** The reminder cron fetched
  appointments as CONFIRMED and then messaged them without re-checking — a
  cancellation/reschedule landing between the fetch and the send could receive
  a reminder SMS for a just-cancelled appointment. It now re-reads status
  immediately before sending (`findUnique … select status`), skipping anything
  no longer CONFIRMED. The residual window during the send itself is inherent
  to external messaging I/O and is documented in the code.
- **Constant-time cron-secret comparison.** `requireCronSecret` compared the
  header with `!==`; it now SHA-256-hashes both sides and compares with
  `crypto.timingSafeEqual` (hash-then-compare so unequal lengths can't throw).
- **Expiry restricted to ONLINE-source bookings.** The plan says manual
  bookings are created CONFIRMED, but if a MANUAL PENDING ever existed the
  cron would silently auto-cancel it. `expirePendingBookings` now filters
  `source: ONLINE`, keeping staff-created PENDING bookings a staff decision.
- **New tests:** a cancelled in-window appointment is never reminded; a stale
  MANUAL PENDING booking is not auto-expired; and wording tests lock the three
  new templates (reminder = "rappel", no-show = "n'êtes pas venu", expired =
  "n'a pas été confirmée … annulée" — never a false "confirmé"). Suite now
  **231 passing**.