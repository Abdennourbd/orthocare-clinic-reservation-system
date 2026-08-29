---
name: guard-erasure-surface-inventory
description: Patient identity is NOT only in the Patient table — the full list of columns an erasure/retention audit must enumerate, and why the FK graph alone misses half of them
metadata:
  type: project
---

An erasure audit that follows only the `patientId` foreign keys is incomplete. Patient
identity in this repo lives in three distinct shapes, and only the first was originally
reachable by FK from `Patient`:

1. **FK-reachable rows** — `Appointment.visitNotes`, `Visit.notes`/`treatment`,
   `SmsMessage.to`/`body`/`error` (`error` is a provider string; the stub providers
   return static text today, but a real gateway routinely echoes the recipient number),
   `WaitlistEntry` (no free text, but it keeps a live `active: true` subscription and
   records which service the person wanted). **Fixed** in `src/lib/privacy/anonymize.ts`
   as of task-13.md étape 6 TOUR 2: `SmsMessage.error` is now nulled and `WaitlistEntry`
   is now `active: false` + `preferredDates: []`, all in the same transaction.
2. **Denormalized copies with no FK at all** — `Notification.payload` is a `Json` blob
   fanned out one row per active staff user by `src/lib/messaging/notifications.ts`.
   **Fixed** as of TOUR 2 (CRITICAL): the fix removed `patientName` from all 4 payload
   types entirely rather than adding a scrub path, so erasure is automatically effective
   here — there is nothing to reach because nothing identifying is ever written. Any
   future screen reading `Notification` must resolve the name by joining on
   `payload.appointmentId` at render time, never store it in `payload` again.
3. **Keys and side channels** — `RateLimitCounter.key` embeds the raw E.164
   (`phone:<E164>:appointments`, `src/app/api/appointments/route.ts`); it is bounded only
   by `cleanupRateLimitCounters()` (7-day retention, driven by `/api/cron/cleanup`).
   `AuditLog.ipAddress` on `actorType: PATIENT` rows is the patient's own IP and is
   deliberately unreachable — the log is append-only by design.
   `SelfServiceToken` holds no identity but is a live capability URL that survives
   an erasure unless it is explicitly revoked. **Fixed** as of TOUR 2 (MAJEUR-1):
   `anonymizePatient()` now revokes every unused, non-revoked token for the patient's
   appointments in the same transaction (`revokedAt: anonymizedAt`).

Shapes 1 and 2 are handled inside `anonymizePatient()`. Shape 3 has never been inside
its scope at all — those tables are reached by retention/cron paths or by design
decisions, not by the erasure transaction, so read the task-13.md étape 6 Journal for
their current standing rather than assuming this file is up to date on them. Every
"Fixed" note above was written by the implementing agent, not by an auditor: re-prove
each at a `file:line` in the working tree before citing it (see
[[feedback-other-agents-edit-this-memory]]).

Re-audit this list whenever a new column, `Json` payload, or side channel is
added anywhere near `Patient`/`Appointment`/`Visit`/`SmsMessage`/`SelfServiceToken`/
`WaitlistEntry`/`Notification` — this inventory is a checklist, not a one-time fact.

**Why:** the standard the user set is "a partially honored erasure is worse than a
refusal, because it is deemed handled." A scrub that covers the FK graph looks complete
in review and in tests, and still leaves the name in a staff feed.

**How to apply:** for any diff touching erasure, retention, or export, walk the three
shapes above rather than `grep patientId prisma/schema.prisma`. The cheap way to find
shape 2 is `grep -rn "patientName\|firstName" src/lib --include=*.ts | grep -v test` —
any hit that lands in a `Json` column or a payload type is a copy the scrub must reach.
Shape 3 is found by listing every `checkRateLimit(` call and reading the key template.

Related: [[invariant-audit-detail-no-patient-identity]],
[[invariant-minimum-disclosure-read-vs-return]], [[trap-prisma-transaction-read-committed]]
