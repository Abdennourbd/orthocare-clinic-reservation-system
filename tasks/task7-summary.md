# Task 7 — Message abstraction + providers + `SmsMessage` + `Notification`

Delivered per `tasks/todo.md` Task 7 and `tasks/plan.md` (§Messaging, §Domain
model). Built on Task 6's booking route.

## Channel strategy (decided during the task)

**WhatsApp-first + SMS fallback.** Research: Twilio SMS to Algeria is
~$0.27/segment (alphanumeric sender ID required; numeric IDs fail on Mobilis);
WhatsApp Business API is ~$0.01–0.02/message to DZ (per-message billing since
Jul 2025). With ~90% of Algerian numbers on WhatsApp, the hybrid is ~6–7×
cheaper than all-SMS. Full rationale + plan recorded in `plan.md` §Messaging.
Task 7 delivers the abstraction (any channel behind one `MessageProvider`);
real channel wiring is Task 22.

## Done + verified

### Schema (migration `20260826122217_add_messaging_notifications`)

- `SmsMessage` — `to` (E.164), `body`, `patientId?`, `type`, `templateId?`,
  `batchId?`, `provider` (channel used), `status`, `appointmentId?`,
  `sentById?`, `sentAt?`, `error?`; **`@@unique([appointmentId, type])`**
  (idempotent automated sends), indexes on `patientId` / `batchId`.
- `Notification` — `userId`, `type`, `payload (Json)`, `readAt?`, index
  `(userId, readAt)`; fan-out = one row per **active** staff user.
- Enums: `SmsMessageType` (plan's 8 + **`BOOKING_RECEIVED`** — the plan's enum
  had no type for the "request received" message; deviation recorded in
  plan.md), `SmsStatus`, `NotificationType`.
- `Patient.preferredLocale` (locale booked in) + `Patient.whatsappOptIn`
  (Meta's documented-opt-in requirement) — set at booking.
- Migration applied to the **local test DB** (Neon unreachable from this
  session); the migration file is committed and applies to dev/prod via
  `prisma migrate deploy` when the network allows.

### `src/lib/messaging/`

- `provider.ts` — `MessageProvider` interface (`send({to, body}) → {ok,
  status, error?}`). Providers are pure adapters with **no policy**.
- `mock.ts` — returns `SENT`; the dispatcher's `SmsMessage` row IS the mock's
  "log to DB". `twilio.ts` / `whatsapp.ts` — env-gated stubs that fail loudly
  ("wiring lands in Task 22"), so an un-wired production channel can never be
  mistaken for delivered.
- `templates.ts` — templates from the `messageTemplates` Setting (French-only
  for now), `renderTemplate` with `{placeholder}` substitution, built-in
  defaults so a missing Setting never breaks a send.
- `classify.ts` — `NON_TRANSACTIONAL = { NO_SHOW, DELAY, WAITLIST }`; the
  transactional/non-transactional split lives in **one place**.
- `index.ts` — `getProvider()` (env `MESSAGE_PROVIDER`, default/unknown →
  mock) and `sendMessage()` dispatcher: opt-out gate → render → create row →
  provider → persist outcome; `(appointmentId, type)` unique-violation returns
  the existing row (idempotent, no double message).
- `notifications.ts` — `notifyNewBooking()` fans out to active staff.
- `notifyBookingCreated.ts` — orchestrates SMS + notifications **after** the
  booking transaction commits; a messaging failure never fails the booking.

### Booking wiring

- `bookingInputSchema` + wizard payload: `locale` (fr/ar/en) + `whatsappOptIn`
  checkbox (all 3 locales' UI strings added). Stored on the patient via
  `createBooking` upsert.
- `POST /api/appointments` calls `notifyBookingCreated()` after 201 (inside
  try/catch).
- Message wording is a **request**: "…votre demande de rendez-vous … a bien été
  reçue. La clinique vous appellera … pour la confirmer." — asserted never to
  contain "confirmé".

### Seed

- `messageTemplates` Setting seeded with the French `bookingReceived` template
  (Task 21 makes these editable in the dashboard).

## Verification

- `npm test` → **158 passing** (20 files; +25 from Tasks 1–6 baseline), incl.
  new `messaging.test.ts` integration suite and `templates`/`index` unit tests.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes / deferred

- **Audit:** booking-received SMS and NEW_BOOKING notifications are
  patient/system-initiated, not staff actions; `logAction()` lands with the
  Task 12 audit helper (consistent with plan.md — no re-implementation).
- **No new admin endpoints in this task** → authorization-matrix table
  untouched.
- **`GET /api/admin/notifications`** (querying the feed) is Task 12's UI slice;
  rows are already queryable via Prisma.
- The `templateId` on `SmsMessage` stores the template key ("bookingReceived"),
  giving lineage to the Settings template version.