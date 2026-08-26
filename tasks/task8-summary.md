# Task 8 — Self-service link (cancel + reschedule)

Delivered per `tasks/todo.md` Task 8 and `tasks/plan.md` (§Self-service link,
§Audit logging, §Abuse controls). Built on Task 5's `releaseSlot()` and Task
7's messaging dispatcher.

## What was delivered

### Schema (migration `20260826135333_add_self_service_tokens`)

- `SelfServiceToken` — `tokenHash` (SHA-256 only — the raw token is never
  stored), `appointmentId`, `usedAt` (single-use cancel), `revokedAt`
  (rotation), `expiresAt`. `tokenHash @unique`.
- `AuditLog` + `AuditActorType` (`STAFF|SYSTEM|PATIENT`) + the plan's full
  `AuditAction` enum — delivered **ahead of Task 12** because Task 8's
  patient-initiated actions (and Task 9's SYSTEM cron actions) have no staff
  user to pass; a userId-only helper could not express `PATIENT`. Task 12
  builds the admin read surface + authz matrix on top of this model.
- `SmsMessageType.CANCELLED` added (deviation, recorded below).
- Applied to the local dev + test DBs (Neon unreachable this session).

### Domain

- `lib/selfservice/tokens.ts` — `createSelfServiceToken` (requires CONFIRMED,
  computes `expiresAt = endTime + 48h`, **rotates** any live token), `verify`
  (reject order: not-found → used → revoked → expired → inactive appointment,
  each a typed error), `revoke`.
- `lib/selfservice/errors.ts` + `lib/selfservice/http.ts` — typed errors → 404
  (unknown) / 410 (expired/used/revoked/unavailable).
- `lib/selfservice/link.ts` — builds `{APP_URL}/{locale}/appointment/{token}`;
  locale validated against the allow-list before it enters the path.
- `lib/selfservice/actions.ts` — `selfServiceCancel` and `selfServiceReschedule`
  orchestrate: verify → release/book → rotate token → message → staff
  notification → `logAction` (actor `PATIENT`). Side effects never fail the
  action (`safe()`).
- `lib/audit/logAction.ts` — shared append-only audit helper.
- `lib/settings/clinicInfo.ts` — clinic identity for the token page (and later
  the contact page), with documented defaults.
- `lib/booking/bookSlot.ts` / `rescheduleSlot.ts` — optional `status` /
  `newStatus` so a self-service reschedule produces a **CONFIRMED** appointment
  (the patient was already confirmed by phone — no re-confirmation needed).
- `lib/messaging/appointmentChanges.ts` + `notifyCancellation` — patient
  messages (confirmation/cancelled/reschedule) and the staff CANCELLATION
  notification. The confirmation/reschedule messages carry the self-service
  link; the reschedule message carries the **rotated** link for the new
  appointment.

### Routes (all public, rate-limited per IP, CSRF origin-guarded on POST)

- `GET /api/appointments/[token]` — **minimum disclosure only**.
- `POST /api/appointments/[token]/cancel` — via `releaseSlot()`.
- `POST /api/appointments/[token]/reschedule` — via `rescheduleSlot()`; only
  available slots (`bookSlotInTx` re-checks under the advisory lock).

### UI

- `/[locale]/appointment/[token]/page.tsx` + `AppointmentManager` client
  component — shows service, date/time (clinic-local), clinic info and the
  patient's first name; cancel (with confirm step) and reschedule (date picker
  + slot grid reusing `TimeGrid`). All requests are first-party; the page loads
  **no third-party scripts**. i18n keys in FR/AR/EN.

## Key security properties (verified)

- **Token at rest:** only SHA-256 hash stored (unit-tested: the raw token never
  appears in the row). 256-bit random tokens make offline brute force moot.
- **Replay/rotation:** cancel marks `usedAt`; reschedule marks `usedAt` +
  `revokedAt` and issues a fresh token for the new appointment. Old token →
  410.
- **Referrer leakage:** `Referrer-Policy: no-referrer` + `frame-ancestors
  'none'` verified via curl on `/ar/appointment/<token>`; the page HTML loads
  no external scripts.
- **Minimum disclosure:** GET returns exactly service (+id), date/time, clinic
  info and first name — integration test asserts no phone, no `+213`, no last
  name, no email/birthDate/notes/id leak.
- **Abuse:** token lookups 60/h/IP, cancel + reschedule 30/h/IP; POSTs require
  a same-site Origin.
- **Audit:** every cancel/reschedule writes `AuditLog` with `actorType =
  PATIENT`, `userId = null`.

## Deviations (recorded per plan.md practice)

1. **`SmsMessageType.CANCELLED` added.** The plan's 9 message types had no type
   for the patient-facing "your appointment has been cancelled" message that
   Task 8's "confirmation message sent on change" requires (cancel has no
   `RESCHEDULE`/`CONFIRMATION` to send). Transactional; idempotent via the
   `(appointmentId, type)` index.
2. **`AuditLog` delivered ahead of Task 12** (plan.md already noted Tasks 8/9/17
   need the PATIENT/SYSTEM actor model). Task 12 still owns the admin read
   surface, `AUDIT_VIEWED` and the authz matrix.
3. **`clinicInfo` Setting added** — the token page needs clinic address/phone;
   no such setting existed. Seeded with defaults; editable in Task 21.
4. **Rescheduled appointments become CONFIRMED.** A patient who was confirmed
   by phone and reschedules via the link is not re-confirmed; the new
   appointment is created CONFIRMED via `bookSlot`'s new `status` input.
5. **`sendMessage` retries FAILED sends.** The dispatcher now re-attempts a
   failed (provider-error) send on the next call for the same
   `(appointmentId, type)` instead of returning the FAILED row — otherwise a
   transient provider error would permanently block a confirmation message and
   its token link. Exactly-once for SENT rows is unchanged.
6. **Token-page CSP fixed (pre-existing config bug).** `NO_REFERRER_HEADERS`
   had `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`
   with no `script-src` — under that CSP the browser blocks Next.js's own
   inline RSC scripts and the token page **never hydrates** (verified against
   the production build: 10 inline scripts, no nonces). The token-page CSP now
   mirrors the global one (`script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
   …) so first-party JS runs, while `frame-ancestors 'none'` + `connect-src
   'self'` + a `script-src` with no external domains still block every
   third-party script. A comment marks it as a hard override that must never
   gain the Google embed domains Task 10 adds to the global CSP — that is the
   referrer-leak this rule exists to stop. `Referrer-Policy: no-referrer`
   unchanged and verified.

## Verification

- `npm test` → **188 passing** (24 files), incl. new `tokens.test.ts` (10),
  `logAction.test.ts` (3), `link.test.ts` (3) and `tests/integration/self-service.test.ts` (11: full cancel + reschedule flows, min-disclosure, negatives, CSRF, rate limit, token scoping).
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- **Manual (curl against the running app + local dev DB):** token page serves
  `Referrer-Policy: no-referrer` + CSP `frame-ancestors 'none'`; GET returns
  Arabic service name + first name only; cancel → CANCELLED /
  `PATIENT_SELF_SERVICE` + audit row + CANCELLED message + CANCELLATION
  notification; token reuse → 410 `TOKEN_USED`; reschedule → old RESCHEDULED,
  new CONFIRMED, old token dead, audit `SELF_SERVICE_RESCHEDULED`, fresh token
  live.

## Notes / deferred

- **No staff route to send the confirmation** yet — that's Task 14
  (`confirm-after-call`), which calls the already-delivered
  `sendAppointmentConfirmation(appointmentId)`.
- **Waitlist** (Task 17) subscribes to the `slot-freed` event that both
  self-service paths emit via `releaseSlot`/`rescheduleSlot` — no extra code
  needed here.
- Self-service lookups are **not** audited (only actions are) — auditing every
  lookup would let a random-token scanner fill the audit log; rate limiting
  covers guessing.
- The 3 new `SelfService` i18n strings have no visual test in a real browser
  this session (no Chrome available) — covered by the API integration tests +
  build; a visual pass is part of the Task 23 Lighthouse/accessibility run.