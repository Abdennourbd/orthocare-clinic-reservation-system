# Task 16 — SMS Center (Admin Ops)

**Status:** ✅ Complete (9 plan steps; reviewed by code-reviewer + test-engineer in a loop; full verification green)

**Delivery timeline:** Sep 2 — schema `0f8f0ab`, dispatcher bodyOverride + delay template `30b9292`/`ade3175`, domain `fd466fc`, single route `75b8723`, preview+broadcast `51dd755`, history+batches `86c8863`, UI `7d7b284`, UI review fixes `f7414e6`. Sep 3 — final verification + docs.

## What was delivered

### Backend
- **`src/lib/messaging/smsCenter.ts`** — the delay-broadcast domain module. **`splitAudience`** (pure, unit-tested) splits a day's appointments into recipients (status PENDING/CONFIRMED + active, non-anonymized, non-opted-out patient) vs `excluded` with exactly one reason each (CANCELLED/RESCHEDULED/COMPLETED/NO_SHOW → then OPTED_OUT → INACTIVE). **`previewBroadcast(date)`** returns audience + recipientCount + a sample body (rendered from the admin-editable `delay` template) with **zero writes**. **`runBroadcast(...)`** creates the `SmsBroadcast` batch row first (unique `idempotencyKey` → P2002 returns the existing batch, `alreadySent: true`, zero sends), then sends sequentially (not `Promise.all` — gentle on provider rate limits) via `sendMessage` so the opt-out gate and row lifecycle cannot be bypassed, then persists the three counters and audits `SMS_SENT`. Delay sends deliberately carry **no `appointmentId`** — the `(appointmentId, type)` unique index would otherwise block a second delay broadcast the same day; the batch row is the idempotency guarantee instead.
- **`src/lib/messaging/index.ts`** — dispatcher gained `bodyOverride` (≤480 chars, exclusive with `templateId`) so free-text single SMS flows through the same single gate.
- **`src/lib/messaging/templates.ts`** — `delay` key: "Bonjour {firstName}, votre rendez-vous de {time} aujourd'hui est retardé d'environ {delayMinutes} minutes. Ortho'Care Clinic"; Settings override wins (unit-tested both).
- **`src/lib/messaging/rateLimits.ts`** — `SMS_SEND_RATE_LIMIT` (20/5min), `SMS_BROADCAST_RATE_LIMIT` (5/5min), `SMS_READ_RATE_LIMIT` (60/5min), keyed `staff:<userId>:sms-*`.
- **`src/schemas/sms.ts`** — `singleSmsSchema`, `broadcastPreviewSchema`/`broadcastSendSchema` (date optional → clinic today; delayMinutes 1–480; idempotencyKey 8–100), `smsHistoryQuerySchema` (batch/patient/type filters + cursor), `smsBatchesQuerySchema`. FR validation messages.
- **`prisma/schema.prisma`** — `SmsBroadcast` model (migration `20260902155429_add_sms_broadcast`): id doubles as batchId, `idempotencyKey @unique`, date (clinic-local YYYY-MM-DD), delayMinutes, recipientCount/sentCount/suppressedCount/failedCount, sentById (SET NULL), createdAt index.
- **5 routes**, all with the load-bearing handler order (`requireStaff` → CSRF on POST → rate limit → Zod → domain check; 404 never precedes 401/403) and named-field selects:
  - `POST /api/admin/sms/single` — ADMIN+RECEPTIONIST. Patient must exist + `active` + `anonymizedAt: null` else 404; sends `MANUAL` with `bodyOverride`; audits `SMS_SENT` (detail: ids + enum + status, never body/phone). Response never echoes the body.
  - `POST /api/admin/sms/broadcast/preview` — **ADMIN only**, no writes, returns recipients + excluded-with-reasons + count + sampleBody.
  - `POST /api/admin/sms/broadcast` — **ADMIN only**, calls `runBroadcast`, returns `{ batchId, sentCount, suppressedCount, failedCount, alreadySent }`.
  - `GET /api/admin/sms` — cursor-paginated history, filters batchId/patientId/type; audited `PATIENT_RECORD_VIEWED` (scope `sms-history`, ids/counters only — message bodies are patient-identifying).
  - `GET /api/admin/sms/batches` — batch metadata only (no bodies, no patients → **not** audited).

### UI (`/admin/sms`, FR dashboard)
- **`src/components/admin/SmsCenter.tsx`** — tab shell (Envoi manuel / Diffusion / Historique).
- **`ManualSmsForm.tsx`** — patient search picker (reuses patients search), 480-char textarea with live counter, status feedback.
- **`BroadcastForm.tsx`** — ADMIN-only two-step flow where **the preview IS the confirmation**: preview shows recipient table + exclusions-with-reasons + count + sample body; "Envoyer la diffusion" only appears after. Double-click safety = idempotencyKey minted **once** at preview time (kept in state; stale on date/delay change) + disabled submit while pending.
- **`SmsHistory.tsx`** — batches list + cursor-paginated messages with batch filter, all 10 types mapped to FR labels.
- **`Sidebar.tsx`** — nav item `{ href: "/admin/sms", label: "SMS", adminOnly: false }`.

### Tests
- **`src/lib/messaging/smsCenter.test.ts`** — `splitAudience` unit tests for every exclusion reason + order preservation.
- **`tests/integration/sms-center.test.ts`** — single (happy path + anonymized 404 + Zod 400), preview (exact count, zero rows written), broadcast (shared batchId, counts, opted-out excluded, **double-submit `alreadySent: true` with unchanged `SmsMessage.count`**, receptionist 403), history (filters + cursor pagination + audit), batches (newest-first + both roles).
- **`tests/authz-matrix.test.ts`** — 5 rows × 4 actors, handlers imported **by reference**: single/history/batches allowed `[ADMIN, RECEPTIONIST]`; preview/broadcast allowed `[ADMIN]`.
- **Component tests** — `ManualSmsForm.test.tsx` + `BroadcastForm.test.tsx` (preview→confirm flow, idempotency-key behaviour, provider-error surface).

## Verification
`npm test` **712/712 green** (incl. SMS integration suite, templates, authz matrix, component tests), `npm run typecheck` + `npm run lint` + `npm run build` clean.

## Notes / decisions
1. **Delay messages carry no `appointmentId`** — required so a second delay broadcast the same day is not silently blocked by the `(appointmentId, type)` unique index; the batch row is the idempotency guarantee (documented in `smsCenter.ts` + schema).
2. **MANUAL is transactional** — a deliberate staff send to an opted-out patient still goes (plan §Transactional vs non-transactional). Broadcast DELAY is non-transactional → opt-out respected.
3. **History read is audited; batches read is not** — bodies+names are patient-identifying, batch metadata is not.
4. **Responses never echo a message body** — the single-send route and audit details carry ids/enums/status only.