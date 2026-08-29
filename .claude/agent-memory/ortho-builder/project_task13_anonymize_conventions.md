---
name: project-task13-anonymize-conventions
description: Conventions established by task-13.md step 6 (src/lib/privacy/anonymize.ts + POST /[id]/anonymize) — read before any future "erasure"/irreversible-action route in this repo
metadata:
  type: project
---

- **A domain function that takes `(actor: AuditActor, ipAddress?)` calls
  `logAction()` itself, AFTER its own `$transaction` commits — the route
  handler does NOT call `logAction()` a second time.** This resolves an
  ambiguity in task-13.md's step-6 card (which describes the audit write as
  a route-handler step) by following the repo's actual existing precedent:
  `selfServiceCancel`/`selfServiceReschedule`
  (`src/lib/selfservice/actions.ts`) both take `ipAddress` and call
  `logAction()` themselves post-commit, never from the caller. Reason
  `logAction()` can't be inside the `$transaction`: it uses the
  `getPrisma()` singleton, not the transaction's `tx` client. If a future
  step's card also gives a domain function `actor`/`ipAddress` params, that
  is the signal it owns its own audit write — don't duplicate the call in
  the route.
- **`updateMany(...).count` IS the "kept" count — no separate `.count()`
  query needed.** `anonymizePatient()` computes `appointmentsKept`/
  `visitsKept`/`smsMessagesScrubbed` directly from the three `updateMany`
  results inside the transaction (the count of rows matched by
  `where: { patientId }` equals the total row count for that patient,
  regardless of whether the target fields were already null).
- **⚠️ CORRECTED (TOUR 2, 2026-08-30): a `findUnique`-then-`update` idempotence
  check inside a Prisma `$transaction()` is NOT race-safe**, even though it
  reads and writes inside "the same transaction". Prisma's `$transaction()`
  runs at Postgres' default READ COMMITTED with no `isolationLevel` option,
  and `findUnique` is not `SELECT ... FOR UPDATE` — two concurrent callers can
  both read `anonymizedAt: null` and both successfully `UPDATE`, producing two
  audit rows (indelible, `AuditLog` is append-only) and a re-stamped
  `anonymizedAt`. `ortho-security` proved this with two concurrent `psql`
  sessions AND it was reproduced at the application level with a widened race
  window (`tests/`-only temporary `setTimeout` between read and write) — see
  [[trap-prisma-transaction-read-committed]] (ortho-security memory). **The
  real fix**: make the first write itself the guard — a conditional
  `tx.patient.updateMany({ where: { id, anonymizedAt: null }, data: {...} })`
  and branch on `.count === 0` to throw. Postgres' own row-locking on that
  `UPDATE` is what makes it exclusive; a plain read never was. If
  `count === 0` and you still want to distinguish 404 vs 409, a follow-up
  `findUnique` for THAT PURPOSE ONLY is fine — it carries no race requirement
  since the write decision is already locked in.
- **`SmsMessage` erasure is neutralize-not-delete, same shell philosophy as
  `Appointment`/`Visit`**: only `to`/`body` become `""`; `status`,
  `provider`, `sentAt`, `type` (there is no `channel` column despite some
  task-relay wording implying one) survive so send-volume stats stay exact.
  This was a dated 2026-08-28 user ruling that EXTENDED the original step-6
  card (task-13.md §Exigences point 4) — always check §Exigences for a
  later, overriding arbitrage before trusting a step card's file list.
- **`Visit.type` surviving anonymization is safe specifically because
  `visitCreateSchema` is its only write path** (a Zod enum of 5 values,
  never free text) — this closes a MAJEUR-2 debt flagged all the way back
  at step 1. A test asserting the post-anonymization `type` is one of
  `visitTypeValues` is the proof, not just a comment.
- Route ordering for an ADMIN-only irreversible action mirrors the rest of
  the `/api/admin/patients/[id]*` family exactly: `requireStaff` →
  `assertSameOriginStrict` → `checkRateLimit` (shared
  `staff:<userId>:patients-write` bucket, `PATIENTS_WRITE_RATE_LIMIT`) →
  Zod → 404 → 409 → domain call. See
  [[project-task13-id-routes-conventions]] for the sibling routes this one
  copies from.

- **(TOUR 2) The erasure surface was wider than the FK graph from `Patient`.**
  `anonymizePatient()`'s transaction now also: revokes every unused,
  non-revoked `SelfServiceToken` for the patient's appointments
  (`revokedAt: anonymizedAt`) — an unrevoked token is a live capability URL
  that survives "erasure"; deactivates `WaitlistEntry` rows and clears
  `preferredDates`; nulls `SmsMessage.error` (a real gateway's rejection
  message often echoes the recipient number, latent until Task 22 wires a
  real provider). Full checklist: [[guard-erasure-surface-inventory]]
  (ortho-security memory) — read it before touching this module again, it is
  a live inventory, not a one-time fact.
- **`Notification.payload` must never carry a patient name.** It has no FK to
  `Patient` (`createMany` writes a plain `Json` blob per active staff user),
  so no cascade in `anonymize.ts` can ever reach a name baked in there. The
  fix was upstream, not in `anonymize.ts`: the 4 payload types in
  `src/lib/messaging/notifications.ts` (`NewBookingNotificationPayload` etc.)
  and their 4 producers no longer accept/pass `patientName` at all — erasure
  is automatic because there's nothing to scrub. Any future screen reading
  `Notification` resolves the name by joining on `payload.appointmentId` at
  render time.

See also [[project-task13-id-routes-conventions]] and
[[project-task13-patients-route-conventions]].
