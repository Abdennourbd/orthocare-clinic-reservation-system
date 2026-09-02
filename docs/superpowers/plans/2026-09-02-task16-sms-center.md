# Task 16 — SMS Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin SMS center — manual single SMS to a patient + delay broadcast to a day's appointments with preview, idempotency, opt-out exclusion, history and audit.

**Architecture:** Reuse the Task 7 messaging stack (`sendMessage` dispatcher, `MessageProvider`, templates-from-Settings, non-transactional opt-out gate already enforced for `DELAY`). Add one small table `SmsBroadcast` for idempotent batches, a domain module `src/lib/messaging/smsCenter.ts`, 5 thin routes, one `/admin/sms` page. One dispatcher extension: `bodyOverride` so free-text single SMS flows through the same single gate (row lifecycle, failure recording) instead of bypassing it.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (Postgres), Zod 4, Vitest, Tailwind 4.

**Spec:** `tasks/todo.md` Task 16 + `tasks/plan.md` §Admin Messaging routes table (§Audit, §Messaging). Spec is the binding authority; this plan is its argument.

**Confirmed decisions:** recipients = PENDING + CONFIRMED (CANCELLED/RESCHEDULED/COMPLETED/NO_SHOW excluded with reason); single SMS = free text (MANUAL is transactional → deliberate sends to opted-out patients still go); preview & broadcast both ADMIN-only; receptionist can send single SMS.

## Global Constraints (repo conventions, bind every task)

- Handler order: `requireStaff` → CSRF (`assertSameOriginStrict` on POST) → rate limit → Zod → domain checks → DB write. 404 never precedes 401/403.
- Explicit roles, never bare `requireStaff`: single/history/batches `["ADMIN","RECEPTIONIST"]`; preview/broadcast `["ADMIN"]`.
- Audit `detail` carries ids/counters/enums only — never name/phone/message body.
- Rate limits keyed `staff:<userId>:sms-*`, declared in one file.
- No `...spread` into Prisma; all date maths via `lib/time/clinicTime.ts` ("today" = clinic today).
- Messaging failures never fail the caller's operation (`sendMessage` already guarantees this).
- Authz matrix rows reference route exports **by reference**.
- Dashboard is FR only; params are Promises in Next 16; French Zod messages.

## Acceptance criteria (from tasks/todo.md Task 16)

- [ ] Single manual SMS sends and logs (SmsMessage with patientId)
- [ ] Broadcast sends to all today's appointments; logged with shared batchId
- [ ] Delay template renders ("votre rendez-vous ... est retardé de X minutes")
- [ ] Templates editable from Settings (Task 21) — templates already read from `messageTemplates` Setting
- [ ] Broadcast permission: admin-only (receptionist blocked)
- [ ] Preview shows the recipient count before anything is sent; submitting twice with the same idempotency key sends once
- [ ] Cancelled appointments excluded; opted-out patients excluded from the delay broadcast
- [ ] Every send audited (`SMS_SENT`) with `batchId` and recipient count

## Task 1 — Schema: `SmsBroadcast` (migration)

**Files:**
- Modify: `prisma/schema.prisma` (add model + `smsBroadcasts SmsBroadcast[]` on `User`)
- Create: migration via `npm run db:migrate -- --name add_sms_broadcast`

```prisma
model SmsBroadcast {
  id              String   @id @default(cuid()) // doubles as batchId on its SmsMessage rows
  date            String   // clinic-local YYYY-MM-DD targeted
  delayMinutes    Int
  idempotencyKey  String   @unique // double-click protection: P2002 → return existing batch, send nothing
  recipientCount  Int
  sentCount       Int      @default(0)
  suppressedCount Int      @default(0) // opt-out/inactive — dispatcher returned null
  failedCount     Int      @default(0)
  sentById        String?
  sentBy          User?    @relation(fields: [sentById], references: [id])
  createdAt       DateTime @default(now())

  @@index([createdAt])
}
```

**Verify:** `npx prisma validate` + `npm test -- schema` green. Commit.

## Task 2 — Dispatcher `bodyOverride` + `delay` template key

**Files:**
- Modify: `src/lib/messaging/index.ts` (optional `bodyOverride?: string` ≤480 chars on `SendMessageInput`; used instead of template rendering; `templateId` stays null)
- Modify: `src/lib/messaging/templates.ts` — add key:

```ts
delay: "Bonjour {firstName}, votre rendez-vous de {time} aujourd'hui est retardé d'environ {delayMinutes} minutes. Ortho'Care Clinic",
```

**Test:** extend `src/lib/messaging/templates.test.ts` — delay key renders `{firstName}`/`{time}`/`{delayMinutes}`; Settings override wins; dispatcher with `bodyOverride` records exact body with `templateId: null`; MANUAL (transactional) sends to opted-out patient. Run `npm test -- src/lib/messaging` → green. Commit.

## Task 3 — Schemas, rate limits, domain module

**Files:**
- Create: `src/schemas/sms.ts`, `src/lib/messaging/rateLimits.ts`, `src/lib/messaging/smsCenter.ts`, `src/lib/messaging/smsCenter.test.ts`

Schemas:
- `singleSmsSchema`: `{ patientId: string.min(1), body: z.string().trim().min(1).max(480) }`
- `broadcastPreviewSchema` / `broadcastSendSchema`: `{ date?: z.string().date(), delayMinutes: z.number().int().min(1).max(480), idempotencyKey: z.string().min(8).max(100) (send only) }`
- `smsHistoryQuerySchema`: `{ batchId?, patientId?, type?, cursor?, limit? (≤100, default 50) }`

Rate limits (`src/lib/messaging/rateLimits.ts`): `SMS_SEND_RATE_LIMIT` (20/5min), `SMS_BROADCAST_RATE_LIMIT` (5/5min), `SMS_READ_RATE_LIMIT` (60/5min) — keyed `staff:<userId>:sms-*` by routes.

Domain module exports (consumed by routes + tests):
```ts
export type BroadcastAudience = {
  recipients: Array<{ appointmentId: string; patientId: string; firstName: string; lastName: string; phone: string; startTime: Date }>;
  excluded: Array<{ appointmentId: string; reason: "CANCELLED" | "RESCHEDULED" | "COMPLETED" | "NO_SHOW" | "OPTED_OUT" | "INACTIVE" }>;
};
export function splitAudience(appointments: AppointmentWithPatient[]): BroadcastAudience; // PURE — unit-tested
export async function previewBroadcast(date: string): Promise<BroadcastAudience & { sampleBody: string }>;
export async function runBroadcast(input: { date: string; delayMinutes: number; idempotencyKey: string; sentById: string; }): Promise<{ batchId: string; sentCount: number; suppressedCount: number; failedCount: number; alreadySent: boolean }>;
```

`runBroadcast`: load audience → `smsBroadcast.create` (P2002 on `idempotencyKey` → return existing batch, `alreadySent: true`, **zero sends**) → sequential `sendMessage({ type: DELAY, batchId: id, to: phoneE164, templateKey: "delay", vars: { firstName, time: formatClinicLocalTime(startTime), delayMinutes } })` (**no** `appointmentId` — the `(appointmentId,type)` unique index must not block two delay broadcasts a day, per the schema comment) → nulls counted `suppressedCount`, FAILED rows `failedCount` → update row → audit `SMS_SENT` (entityType `"SmsBroadcast"`, entityId = batchId, detail `{ date, delayMinutes, recipientCount, sentCount, suppressedCount, failedCount }`). Recipient statuses: PENDING + CONFIRMED only; day bounds via `getClinicDayBoundsUTC`.

**Test:** `src/lib/messaging/smsCenter.test.ts` — `splitAudience` unit tests for every exclusion reason. Run → green. Commit.

## Task 4 — Route: `POST /api/admin/sms/single`

**Files:**
- Create: `src/app/api/admin/sms/single/route.ts`

Both roles. Patient must exist + `active: true` + `anonymizedAt: null` → else 404. `sendMessage({ type: MANUAL, patientId, to: patient.phoneE164, bodyOverride, sentById: guard.user.id })` → audit `SMS_SENT` (entityType `"SmsMessage"`, entityId = message.id, detail `{ patientId, type: "MANUAL", status }`).

**Test:** integration in `tests/integration/sms-center.test.ts` — row logged with `patientId` + `sentById`; audit exists; anonymized → 404; Zod 400 on empty body. Commit.

## Task 5 — Routes: preview + broadcast (the guardrails task)

**Files:**
- Create: `src/app/api/admin/sms/broadcast/preview/route.ts` (ADMIN-only; returns recipients + excluded + count + sampleBody; **no writes**)
- Create: `src/app/api/admin/sms/broadcast/route.ts` (ADMIN-only; calls `runBroadcast`, returns `{ batchId, sentCount, suppressedCount, failedCount, alreadySent }`)

**Tests:** preview shows exact count for seeded day (PENDING + CONFIRMED), cancelled/opted-out in excluded, zero `SmsMessage` rows created. Broadcast: all recipients got a `DELAY` row sharing one `batchId`; `SmsBroadcast` counts correct; opted-out patient has no DELAY row. **Double-submit:** same `idempotencyKey` twice → second response `alreadySent: true`, `SmsMessage.count` unchanged. Receptionist → 403 on both. Commit.

## Task 6 — Routes: history + batches

**Files:**
- Create: `src/app/api/admin/sms/route.ts` (GET, cursor pagination, named-field select incl. patient name + body, filters batchId/patientId/type; audited `PATIENT_RECORD_VIEWED` scope `"sms-history"` + resultCount)
- Create: `src/app/api/admin/sms/batches/route.ts` (GET, `SmsBroadcast` desc, counts + date; metadata only, no audit)

**Test:** filters return right rows; batches newest-first; both roles allowed. Commit.

## Task 7 — Authz matrix rows

**Files:**
- Modify: `tests/authz-matrix.test.ts` — 5 rows × 4 actors, handlers **by reference**: single/history/batches `okStatus: 200` allowed `[ADMIN, RECEPTIONIST]`; preview/broadcast allowed `[ADMIN]`.

Run `npm test -- authz-matrix` → green. Commit.

## Task 8 — UI: `/admin/sms` (FR dashboard)

**Files:**
- Create: `src/app/admin/(dashboard)/sms/page.tsx` + `src/components/admin/sms/` components
- Modify: `src/components/admin/Sidebar.tsx` — nav item `{ href: "/admin/sms", label: "SMS", adminOnly: false }`

Three sections: **Envoi manuel** (patient picker reusing patients search + textarea + send with status feedback); **Diffusion** (ADMIN-only: date defaulting to clinic today, delayMinutes, "Aperçu" → recipient table + excluded-with-reasons + count → "Envoyer" with `crypto.randomUUID()` key generated at preview-confirm, button disabled while in-flight); **Historique** (batches table + message list with batch filter). Loading/empty/error states, keyboard-navigable, visible focus rings.

**Verify:** `npm run build` green. Commit.

## Task 9 — Full verification

`npm run lint` → `npm run typecheck` → `npm test` → `npm run build`, all green. Manual-route smoke via tests. Final whole-branch review. Commit any fixes.
