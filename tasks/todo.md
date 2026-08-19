# Task List: Ortho'Care Clinic Website

Task details + rationale live in `tasks/plan.md`. This is the working checklist. Implement strictly in order — each task leaves a working system.

**Testing approach:** Vitest + dedicated test Postgres DB. Every backend slice ships with a route-level integration test against the test DB, not just curl. Unit tests for pure logic. Manual verification for UI/i18n/RTL. **Test data is synthetic only — never a copy of real patient data.**

**Definition of Done — applies to every task below:**
- [ ] Code reviewed and merged; lint + typecheck + tests green in CI
- [ ] Tests written at the right level (unit for pure logic, route-level integration for endpoints)
- [ ] **If it touches patient data or staff actions: `logAction()` called with the right actor**
- [ ] **If it adds an endpoint: a row added to the authorization matrix test** (`tests/authz-matrix.test.ts`)
- [ ] Input validated with a Zod schema shared between route handler and form
- [ ] `plan.md` updated if architecture or data model changed
- [ ] Works in all 3 locales where user-facing (RTL checked for Arabic)

**Skill notes:** each task carries a `**Skill:**` line — the kind of skill worth studying or installing before starting it. A project-wide shortlist is at the end of this file.

## Phase 1: Foundation

## Task 1: Scaffold project
**Description:** Initialize Next.js (App Router, TypeScript, Tailwind, ESLint) following the directory layout in `tasks/plan.md` → "Code Structure"; add Prisma + Postgres (dev + test DBs), Vitest, Zod, Vercel Blob env, GitHub Actions CI (build + lint + typecheck + test). Also: provision a **staging environment** (own DB, own Blob store, mock messaging, synthetic data only) and add the Postgres-backed rate-limit counter table used by public endpoints.
**Acceptance criteria:**
- [ ] `npm run dev` serves the app
- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] Prisma schema migrates against dev + test Postgres
- [ ] Basic layout renders
- [ ] CI passes on PR (GHA workflow exists)
- [ ] Vercel Blob env vars documented in `.env.example`
- [ ] Structure matches plan.md "Code Structure" section (src/ layout, middleware.ts, messages/, prisma/, tests/)
- [ ] Staging environment deploys and is reachable, with its own database
- [ ] Rate-limit helper (`lib/security/rateLimit.ts`) present with a unit test
- [ ] No secret is committed; `.env.example` lists every variable with a comment
**Verification:** `npm run build` succeeds; `npx prisma migrate dev` + `prisma migrate deploy` against test DB succeed; CI green; staging URL loads.
**Dependencies:** None
**Estimated scope:** Medium (1–2 days)
**Skill:** A **Next.js App Router scaffolding** skill and a **CI/GitHub Actions** skill. Both are conventional setup work — helpful, not critical. Worth having before you start so the directory layout matches plan.md on the first try.

## Task 2: i18n foundation + site shell + `localized()` helper
**Description:** Add `next-intl` with `fr`, `ar`, `en` locales, RTL support, locale switcher; build header, footer, hero, nav; deliver `localized(field, locale, fallback='fr')` helper for JSON per-locale DB fields, with unit tests.
**Acceptance criteria:**
- [ ] All 3 locales render; Arabic uses RTL
- [ ] Locale switcher works and persists (cookie)
- [ ] Site shell matches current clinic branding (colors, logo, hero)
- [ ] `localized()` returns the requested locale or falls back to FR; unit tests cover missing locale + null field
- [ ] Arabic webfont subsetted; the font payload is measured and recorded (Arabic fonts are heavy by default)
**Verification:** Manual check across `/fr`, `/ar`, `/en`; `npm test -- localized`; typecheck passes.
**Dependencies:** Task 1
**Estimated scope:** Medium (2–3 days)
**Skill:** An **i18n / next-intl skill** (locale routing, RTL, fallbacks) — genuinely worth having, since RTL mistakes are cheap to prevent and expensive to retrofit. The available **frontend-design** skill helps with the shell and typography.

## Checkpoint: After Tasks 1-2 (Foundation)
- [ ] All tests pass, build clean, CI green
- [ ] 3 locales + RTL working
- [ ] `localized()` helper unit-tested
- [ ] Staging environment live with its own database, synthetic data only
- [ ] Review with human before proceeding

## Phase 2: Scheduling Engine (no UI — highest risk first)

## Task 3a: Core schema (auth + patients + services + appointments)
**Description:** Define `User` (tokenVersion, mustChangePassword, lastLoginAt, failedLoginCount, lockedUntil), `Patient` (soft-delete, createdById/updatedById, **phoneE164 indexed**, consentAt/consentVersion, messagingOptOut, anonymizedAt), `Service` (durationMinutes, currency, JSON per-locale, soft-delete), `Appointment` (status enum, nullable creator/confirmedBy, per-status timestamps, **reminderSentAt**, cancelReason, nullable resourceId); add `lib/phone/normalize.ts`; migrate; minimal seed (1 admin user, 2-3 services with durations, 1 patient) — just enough to test the engine.
**Acceptance criteria:**
- [ ] All 4 models defined and migrated
- [ ] `Appointment.status` covers PENDING/CONFIRMED/COMPLETED/NO_SHOW/CANCELLED/RESCHEDULED
- [ ] `createdByUserId` / `confirmedByUserId` are nullable
- [ ] `cancelledAt` / `completedAt` / `noShowAt` / `reminderSentAt` present
- [ ] `Patient.phoneE164` indexed (non-unique); normalization helper unit-tested against DZ formats (`0550…`, `+213…`, `00213…`, with spaces)
- [ ] Consent fields and `messagingOptOut` present
- [ ] `resourceId` present but unused (reserved for a second chair — see plan.md single-resource assumption)
- [ ] Minimal seed loads; **the admin password comes from an env var, never a hardcoded default** (a seeded default password in a shared environment is a breach waiting to happen)
**Verification:** `prisma migrate dev` + `prisma db seed` succeed; `npm test` (schema smoke test + phone normalization).
**Dependencies:** Task 1
**Estimated scope:** Medium (1–2 days)
**Skill:** A **Prisma / relational data-modeling** skill (indexes, nullability, migrations, soft-delete patterns). **The highest-value install on the whole project** — every later task inherits these decisions, and schema mistakes are the most expensive kind to fix.

## Task 3b: Content schema + full seed
**Description:** Define `Testimonial`, `FaqItem`, `GalleryItem` (JSON per-locale, `active`), `Setting` (key, JSON value; working-hours schema documented), **`ScheduleException`** (closure dates: range, full/partial day, reason, optional per-service); migrate; full seed from current clinicorthocare.com (services, testimonials, FAQ, default working hours Sat–Thu 10h–17h Fri closed, slot granularity, buffer) plus booking-policy settings (`pendingExpiryHours` 24, `minLeadTimeMinutes` 120, `maxHorizonDays` 90, `clinicTimezone` Africa/Algiers, `consentVersion`).
**Acceptance criteria:**
- [ ] Content models + Setting defined and migrated
- [ ] Seed data matches current clinic content; services have durations
- [ ] Working-hours Setting seeded with documented JSON schema, times noted as clinic-local
- [ ] `ScheduleException` model migrated; at least one holiday seeded as an example
- [ ] Booking-policy settings seeded with documented defaults
- [ ] All per-locale fields populated in FR + AR + EN
**Verification:** `prisma migrate dev` + `prisma db seed` succeed; query seeded data in 3 locales.
**Dependencies:** Task 3a
**Estimated scope:** Medium (2–3 days)
**Skill:** Same **Prisma / data-modeling** skill as Task 3a, plus a **seed-data / content-migration** approach for pulling the current site's content into three locales. ⚠ **`ScheduleException` and the booking-policy settings must land here** — Task 4 consumes both, and adding them later means rewriting the slot engine.

## Task 4: Slot engine (pure logic)
**Description:** Clinic-timezone conversion (`lib/time/clinicTime.ts` — the only module that knows Africa/Algiers), working hours lookup (per weekday from Settings), **closure subtraction** (`ScheduleException`), **booking-window policy** (minimum lead time, maximum horizon, no past dates), slot generation per service, overlap detection, availability query. Pure functions, no DB writes — only reads. Takes an optional `resourceId` that defaults to a single implicit resource (v1 = one chair).
**Acceptance criteria:**
- [ ] `generateSlots(date, service)` returns candidate start times inside working hours
- [ ] Overlapping active appointments excluded from results
- [ ] Handles lunch break, inter-appointment buffer, day boundaries
- [ ] Respects Service.durationMinutes for slot length
- [ ] All times stored/compared in UTC but generated against **clinic-local** working hours; tests cover 00:00 and 23:59 local
- [ ] Closure dates (full-day and partial-day) removed from availability
- [ ] Slots inside the minimum lead time, beyond the maximum horizon, or in the past are never offered
**Verification:** Unit tests pass: `npm test -- slot-engine`; edge cases (boundaries, lunch, buffer, buffer-after-lunch, multi-service durations, closures, lead time, horizon, day boundary in local time).
**Dependencies:** Task 3a (schema), Task 3b (Settings seed for working hours **+ ScheduleException + booking policy**)
**Estimated scope:** Large (3–4 days) — highest-risk task on the critical path
**Skill:** A **date/time and timezone-handling** skill (UTC vs local, interval arithmetic, DST-free but still error-prone). This is where silent one-hour bugs come from; a good reference here pays for itself. No framework skill needed — the code is pure TypeScript by design.

## Task 5: Atomic booking action + `releaseSlot()`
**Description:** Transactional `bookSlot()` — re-check availability inside transaction, insert Appointment, conflict → clear error, retry on race. Also deliver `releaseSlot(appointmentId, reason)` shared domain function that cancels/frees an appointment and emits a **slot-freed event** (simple event emitter or in-process pub/sub; no waitlist subscriber yet — that's Task 17). Both exposed as testable server functions.
**Acceptance criteria:**
- [ ] Two concurrent bookings of same slot → exactly one succeeds
- [ ] Conflict returns a clear, typed error (not a crash)
- [ ] endTime computed from service duration
- [ ] `releaseSlot()` frees the slot and emits slot-freed event (verifiable in test)
- [ ] `releaseSlot()` records a `cancelReason` (`STAFF` | `PATIENT_SELF_SERVICE` | `AUTO_EXPIRED` | `CLOSURE`)
- [ ] Reschedule = releaseSlot + bookSlot atomically
**Verification:** Concurrency unit test (Promise.all of N bookings on same slot → 1 success, N-1 typed errors); `npm run typecheck`.
**Dependencies:** Task 4
**Estimated scope:** Medium (2–3 days)
**Skill:** A **database transactions / concurrency** skill (Postgres isolation levels, `SELECT … FOR UPDATE`, `EXCLUDE` constraints, retry-on-conflict). Worth studying before starting — this is the one place where a subtle mistake produces double-booked patients in production.

## Checkpoint: After Tasks 3a-5 (Engine correct)
- [ ] Slot engine unit tests pass (overlap, boundaries, lunch, buffer, closures, lead time, horizon)
- [ ] Clinic-local vs UTC handled correctly at day boundaries (00:00 / 23:59 local)
- [ ] No double-booking under concurrency (automated test)
- [ ] `releaseSlot()` event fires on cancellation, with the correct `cancelReason`
- [ ] **Number of chairs confirmed with the clinic** (the single-resource assumption is only safe once it is verified)
- [ ] Review with human before proceeding

## Phase 3: Public Booking + Communication

## Task 6: Booking wizard UI + `POST /api/appointments` + `GET /api/slots`
**Description:** Vertical slice — public flow: pick service → pick date → see available/occupied slots (occupied shown as reserved) → patient info **+ consent checkbox** → confirm → summary screen. Backend routes: `GET /api/services`, `GET /api/services/[slug]`, `GET /api/slots`, `POST /api/appointments` (calls Task 5 `bookSlot`). Phone normalized to E.164 on submit. `POST /api/appointments` is rate-limited per IP and per phone, with a cap on simultaneously active PENDING bookings per phone.
**Acceptance criteria:**
- [ ] Slots render as available/reserved correctly
- [ ] Booking creates a PENDING appointment via `bookSlot`
- [ ] Conflict shows a user-facing error (slot just taken)
- [ ] Summary screen shows appointment details, and states clearly that **the clinic will call to confirm** (the appointment is not yet confirmed)
- [ ] Consent checkbox required; `consentAt` + `consentVersion` stored; privacy notice linked
- [ ] Phone stored normalized (E.164) and as typed
- [ ] Rate limits and the PENDING cap reject a flood from one IP/phone with a clear message
- [ ] Booking wizard is keyboard-navigable; slot buttons have accessible labels (date + time, not just a number)
- [ ] Route-level integration test: happy path + conflict path + rate-limit path
**Verification:** Manual end-to-end booking; `npm test -- booking`; keyboard-only pass through the wizard.
**Dependencies:** Task 5, Task 2 (i18n/shell)
**Estimated scope:** Large (4–5 days)
**Skill:** The available **frontend-design** skill for the wizard, plus a **form-validation (Zod) skill** for shared client/server schemas and an **accessibility** reference for the slot picker (a grid of buttons is exactly where screen-reader support is usually forgotten).

## Task 7: Message abstraction + providers + `SmsMessage` + `Notification`
**Description:** `MessageProvider` interface; `MockProvider` (logs to DB), `TwilioProvider` (stub, env-gated), `WhatsAppProvider` (stub, env-gated). Add `SmsMessage` + `Notification` models (3c schema). Booking-received message + staff `Notification` rows (NEW_BOOKING, one per active staff user). Provider selected via `MESSAGE_PROVIDER` env. The dispatcher enforces the **transactional vs non-transactional** split in one place: transactional messages always send; non-transactional ones are suppressed for `messagingOptOut` patients.
**Acceptance criteria:**
- [ ] Booking triggers message via provider (mock logs to SmsMessage)
- [ ] Provider selected by env (`MESSAGE_PROVIDER=mock|twilio|whatsapp`)
- [ ] Staff `Notification` rows created on new booking for every active staff user; queryable
- [ ] SmsMessage history queryable by patientId / batchId
- [ ] Opt-out respected for non-transactional types; transactional types still send (unit-tested both ways)
- [ ] Message wording matches reality: a new online booking is **"request received, we will call to confirm"**, not "confirmed"
- [ ] Unique index on `(appointmentId, type)` prevents duplicate automated sends
**Verification:** Manual booking shows message log + notification; unit test on provider interface + dispatch + opt-out.
**Dependencies:** Task 6
**Estimated scope:** Medium (2–3 days)
**Skill:** A **messaging-provider integration** skill (Twilio / WhatsApp Business API: E.164, delivery statuses, template rules, error handling). Worth installing before starting — provider quirks are the bulk of the work here, not the interface.

## Task 8: Self-service link (cancel + reschedule)
**Description:** `SelfServiceToken` model (3c schema: **tokenHash only — the raw token is never stored**, revocable, expiresAt, usedAt). Token embedded in the confirmation message. Public routes: `GET /api/appointments/[token]`, `POST .../cancel`, `POST .../reschedule`. Cancel and reschedule both route through `releaseSlot()` (Task 5) so the slot-freed event fires. Rescheduling issues a fresh token and revokes the old one.
**Acceptance criteria:**
- [ ] Token verifies (not expired, not used, not revoked)
- [ ] Cancel frees the slot via `releaseSlot()`; token marked used
- [ ] Reschedule only into available slots; calls `releaseSlot()` + `bookSlot()`
- [ ] Actions audited **with actor `PATIENT`** + confirmation message sent on change
- [ ] **Minimum disclosure:** the page shows only service, date/time, clinic info and first name — never phone, email, birth date, notes, history, documents or any other appointment
- [ ] `Referrer-Policy: no-referrer` on the token page and **no third-party scripts** on it (otherwise an embedded widget receives the token in the `Referer` header)
- [ ] Token lookups rate-limited; reschedule rotates the token and revokes the previous one
- [ ] Negative tests: expired token, already-used token, revoked token, token for a different appointment — all rejected
- [ ] Integration test: book → open link → cancel/reschedule → slot availability reflects change
**Verification:** Manual flow + `npm test -- self-service`; confirm no third-party request fires on the token page.
**Dependencies:** Task 7, Task 5 (releaseSlot)
**Estimated scope:** Medium (2–3 days)
**Skill:** A **secure-token design** skill (capability URLs, hashing at rest, expiry, replay protection, referrer leakage). This is a patient-facing credential in a forwardable SMS — the one place on the public site where a design mistake exposes real data.

## Task 9: Reminders + no-show follow-up + PENDING expiry cron (mock provider)
**Description:** Vercel Cron routes (CRON_SECRET auth): `/api/cron/reminders` (24h-before SMS to CONFIRMED appointments), `/api/cron/no-show-followup` (mark past CONFIRMED as NO_SHOW + send follow-up SMS), **`/api/cron/expire-pending`** (auto-cancel unconfirmed PENDING bookings past `pendingExpiryHours`, and always before the appointment starts, via `releaseSlot()` — which frees the slot and later triggers the waitlist). Plus `/api/health` for uptime monitoring. Uses mock provider for now; real wiring is Task 22.
**Acceptance criteria:**
- [ ] Cron routes reject without `CRON_SECRET` header
- [ ] Reminders fire for CONFIRMED appointments 24h out
- [ ] No-show follow-up marks NO_SHOW + sets `noShowAt` + sends SMS
- [ ] Expiry cancels stale PENDING bookings through `releaseSlot()` with `cancelReason = AUTO_EXPIRED`, notifies the patient, and creates a staff notification
- [ ] **Every cron job is idempotent — running it twice sends exactly one message** (`reminderSentAt` + unique index)
- [ ] Cron schedules documented in UTC with the intended clinic-local hour written beside them
- [ ] Cron actions audited with actor `SYSTEM`
- [ ] Dry-run against seeded data logs mock SMS correctly
**Verification:** `npm test -- cron` (including a double-run idempotency test); manual trigger with seeded past/future appointments.
**Dependencies:** Task 7
**Estimated scope:** Medium (2 days)
**Skill:** A **scheduled-jobs / idempotency** skill (retries, at-least-once delivery, safe re-runs). No framework skill needed beyond Vercel Cron's basics — the risk here is duplicate messages, not the plumbing.

## Task 10: Google Reviews embed
**Description:** Official Google Reviews embed widget on public site (live rating).
**Acceptance criteria:**
- [ ] Widget renders on public page
- [ ] Works across all 3 locales
- [ ] Allow-listed in the Content-Security-Policy; disclosed in the privacy notice as a data flow to Google
- [ ] **Not loaded on `/[locale]/appointment/[token]` pages** (it would receive the token in the `Referer` header)
- [ ] Page still renders correctly if the widget fails to load
**Verification:** Manual check on public site in `/fr`, `/ar`, `/en`; confirm no widget request on the token page.
**Dependencies:** Task 2
**Estimated scope:** Small (0.5 day)
**Skill:** None needed — an embed snippet plus a locale check. First candidate on the cut list if time runs short.

## Task 11: Public content pages
**Description:** Build public-facing content pages: services list + detail, FAQ, testimonials, gallery, about, contact, **privacy notice**. All consume `localized()` helper (Task 2) + content schema (Task 3b). The privacy notice states what is collected, why, which processors are involved (hosting, database, messaging, error monitoring — all outside Algeria), and how to request correction or deletion.
**Acceptance criteria:**
- [ ] Each page renders in all 3 locales with FR fallback
- [ ] Services list links to detail; detail shows duration + description
- [ ] Gallery, testimonials, FAQ render active items only
- [ ] Contact page renders clinic info + map
- [ ] Privacy notice published in all 3 locales and linked from the booking form and the footer
- [ ] Gallery images optimized and lazy-loaded; page weight measured on a throttled mobile connection
- [ ] Content pages cached/revalidated rather than rendered fresh on every request
**Verification:** Manual check across 3 locales; typecheck; mobile performance spot-check on a throttled connection.
**Dependencies:** Task 2, Task 3b
**Estimated scope:** Medium (3–4 days)
**Skill:** The available **frontend-design** skill, plus a **web-performance** reference for image handling (a dental gallery is image-dense and this is a mobile-first audience). The privacy-notice text needs review by the clinic, not a skill.

## Checkpoint: After Tasks 6-11 (Public booking + comms work end-to-end)
- [ ] Public booking flow works end-to-end, consent recorded
- [ ] Booking-received message + self-service verified; `releaseSlot()` fires on self-service cancel
- [ ] Token page exposes minimum data only and loads no third-party scripts
- [ ] Reminders + no-show + expiry cron run against seeded data (mock SMS); **each run twice sends once**
- [ ] Rate limits reject a booking flood from one IP/phone
- [ ] Google Reviews widget live in 3 locales
- [ ] Public content pages + privacy notice render in 3 locales
- [ ] Review with human before proceeding

## Phase 4: Admin Core

## Task 12: Auth + RBAC + audit helper + dashboard shell
**Description:** Staff login (email/password, signed session cookie with tokenVersion), middleware-protected `/admin`, dashboard shell (FR only), role-gated nav (ADMIN vs RECEPTIONIST), **`logAction(actor, action, entityType, entityId, detail)`** helper + `AuditLog` model (3c schema), and an ADMIN-only audit viewer. Every later staff action calls `logAction`. Includes login throttling with temporary lockout, CSRF origin checks on state-changing requests, cookie hardening (`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix, idle + absolute expiry), argon2id password hashing with a 12-character minimum, and the forced password change flow (`mustChangePassword`).
**Acceptance criteria:**
- [ ] Unauthenticated users redirected from `/admin`
- [ ] Login validates; roles gate views (receptionist cannot see team/settings routes)
- [ ] Deactivated staff (active=false) cannot log in; existing sessions revoked via tokenVersion bump
- [ ] `logAction()` writes to AuditLog with enum action + JSON detail, and accepts **actor `STAFF` | `SYSTEM` | `PATIENT`** (⚠ signature change from v2 — Tasks 8, 9 and 17 have no staff user to pass; fixing it later means touching nine call sites)
- [ ] Login success, failure and lockout are audited; AuditLog is append-only and ADMIN-only to read; reading it logs `AUDIT_VIEWED`
- [ ] Repeated failed logins throttle and then lock the account temporarily
- [ ] State-changing requests reject a mismatched `Origin`/`Referer`
- [ ] Session expires on idle (2h) and absolutely (12h)
- [ ] **Authorization matrix test exists**: every `/api/admin/*` route × {anonymous, receptionist, admin, deactivated} → expected status. This table is updated by every later task that adds a route
- [ ] Unit tests: auth gating per role, tokenVersion revocation, password policy
**Verification:** Manual auth flow; `npm test -- auth`; `npm test -- authz-matrix`; security review of session handling.
**Dependencies:** Task 3a (User schema) — **NOT** Task 7
**Estimated scope:** Large (4–5 days)
**Skill:** An **auth / RBAC / session-security** skill **plus** a **security-review or threat-modeling** skill. Together these are the single most valuable install on the project: this task defines who can reach patient data, and every task after it inherits the decision.

## Task 13: Patient records + duplicate detection
**Description:** Patient CRUD, visit history timeline (COMPLETED appointments UNION Visit rows), notes. Duplicate detection: on create/edit, query patients sharing **normalized phone (E.164)** or name; return warnings; require staff acknowledgment to proceed. `Visit` model (3c schema). Anonymization path for erasure requests (`lib/privacy/anonymize.ts` — scrub identifying fields, set `anonymizedAt`, keep the appointment shell so statistics stay correct). Routes: `GET/POST /api/admin/patients`, `GET/PATCH /api/admin/patients/[id]`, `GET .../history`, `POST .../visits`, `POST .../anonymize` (ADMIN only).
**Acceptance criteria:**
- [ ] Admin creates/edits patient profile; `createdById`/`updatedById` set
- [ ] Visit history shows COMPLETED appointments + Visits in unified timeline
- [ ] Manual visit addable
- [ ] Duplicate match (phone or name) shown; save blocked until acknowledged
- [ ] Duplicate detection matches across DZ phone formats (proves normalization is actually used)
- [ ] Soft-delete only (active=false); anonymization available to ADMIN and audited as `PATIENT_ANONYMIZED`
- [ ] Opening a patient record logs `PATIENT_RECORD_VIEWED` (for patient data, who *looked* matters as much as who changed)
**Verification:** Manual CRUD + duplicate flag test; `npm test -- patient-duplicates`; verify an anonymized patient keeps their appointment history count but loses identifiers.
**Dependencies:** Task 12
**Estimated scope:** Medium (3–4 days)
**Skill:** No specialized skill required — standard CRUD over the Task 3a model. A **fuzzy-matching / record-deduplication** reference helps if you want name matching to tolerate spelling variants (worthwhile for Arabic/French transliterations of the same name).

## Task 14: Appointment management
**Description:** Day view of appointments; **call queue** (`GET /api/admin/appointments/pending` — bookings awaiting a confirmation call, oldest first, showing time left before auto-expiry) and **search by phone or name** (`GET /api/admin/appointments/search` — for when a patient is on the line right now); confirm-after-call, cancel, reschedule (re-checks availability via Task 5), mark completed/no-show, manual booking creation (CONFIRMED, blocks slot). All status changes set the matching timestamp (`confirmedAt`/`cancelledAt`/`completedAt`/`noShowAt`), call `logAction`, and fire SMS. Routes: `GET/POST /api/admin/appointments`, `GET/PATCH .../[id]`, `POST .../[id]/reschedule`.
**Acceptance criteria:**
- [ ] Receptionist changes status; SMS fires + action audited on each change
- [ ] Reschedule re-checks slot availability via `bookSlot`
- [ ] Manual booking creates CONFIRMED appointment that blocks its slot
- [ ] Cancel/reschedule route through `releaseSlot()` (so waitlist fires later) with the right `cancelReason`
- [ ] Per-status timestamps set correctly
- [ ] Call queue lists PENDING bookings oldest-first with time remaining before expiry — this is the receptionist's most frequent daily job and deserves its own screen, not a filtered day view
- [ ] Appointment findable by phone or name in one search
**Verification:** Manual admin flow end-to-end; integration test on status transitions; time a receptionist-style task ("patient calls to cancel") to confirm it takes a few seconds, not a hunt through dates.
**Dependencies:** Task 13 (manual booking needs patient CRUD), Task 5
**Estimated scope:** Large (4–5 days)
**Skill:** No specialized skill needed — this is domain UI over existing functions. The available **frontend-design** skill helps make the day view and call queue genuinely fast to use, which matters more here than anywhere else in the dashboard.

## Task 15: Patient documents
**Description:** `PatientDocument` model (3c schema). Vercel Blob upload/download, patient-scoped, staff-only. **Blobs are stored privately — never as a public URL.** Downloads go through `GET /api/admin/documents/[id]`, which checks the staff session on every request, then streams the file or issues a short-lived signed URL. Routes: `POST /api/admin/patients/[id]/documents`, `GET .../documents`, `GET /api/admin/documents/[id]`, `DELETE ...` (ADMIN only).
**Acceptance criteria:**
- [ ] Upload validated against a MIME allow-list (JPEG, PNG, PDF, DICOM) with a size cap; extension and content type must agree
- [ ] Documents listed per patient; download served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` (an uploaded SVG or HTML file served inline from your own domain is stored cross-site scripting)
- [ ] **A blob URL on its own, with no session, does not grant access** — verified explicitly
- [ ] Non-staff access denied; docs scoped to owning patient
- [ ] Downloads audited (`PATIENT_DOCUMENT_DOWNLOADED`); delete is ADMIN-only, soft-deletes the row, removes the blob, and is audited
**Verification:** Manual upload/download; security check (non-staff → 403, raw blob URL in a logged-out browser → denied); `npm test -- documents`.
**Dependencies:** Task 13
**Estimated scope:** Medium (2–3 days)
**Skill:** A **file-upload security** skill (storage access modes, signed URLs, MIME validation, content-sniffing defences). Worth reading before starting: X-rays are the most sensitive data in the system, and the default "public blob with a random URL" pattern silently fails the staff-only requirement.

## Checkpoint: After Tasks 12-15 (Admin core complete)
- [ ] Staff auth + role gating + audit working; session revocation tested
- [ ] **Authorization matrix test green** for every admin route × every role
- [ ] Login throttling and lockout verified; failures audited
- [ ] Full booking lifecycle driven by receptionist, all actions audited
- [ ] Call queue and phone/name search usable in seconds
- [ ] Patients + documents + duplicates handled
- [ ] Raw document URL without a session is denied; downloads audited
- [ ] Review with human before proceeding

## Phase 5: Admin Ops

## Task 16: SMS Center
**Description:** Manual single SMS to a patient; broadcast to all appointments of a day with delay template ("delayed by X min"); send history with shared `batchId`. Broadcasts require a **preview step** showing the exact recipient list and count before sending, and carry an **idempotency key** so a double-click cannot send twice. Cancelled appointments are excluded from broadcast recipients. Routes: `POST /api/admin/sms/single`, `POST /api/admin/sms/broadcast/preview`, `POST /api/admin/sms/broadcast`, `GET /api/admin/sms`, `GET /api/admin/sms/batches`.
**Acceptance criteria:**
- [ ] Single manual SMS sends and logs (SmsMessage with patientId)
- [ ] Broadcast sends to all today's appointments; logged with shared batchId
- [ ] Delay template renders ("Your appointment today is delayed by X min")
- [ ] Templates editable from Settings (Task 21)
- [ ] Broadcast permission: admin-only (receptionist blocked)
- [ ] Preview shows the recipient count before anything is sent; submitting twice with the same idempotency key sends once
- [ ] Cancelled appointments excluded; opted-out patients excluded from the delay broadcast
- [ ] Every send audited (`SMS_SENT`) with `batchId` and recipient count
**Verification:** Manual send/broadcast; check SmsMessage log; role-gating test; double-submit test.
**Dependencies:** Task 14, Task 13
**Estimated scope:** Medium (2–3 days)
**Skill:** Same **messaging-provider** skill as Task 7, plus a **bulk-send safety** mindset (preview, idempotency, cost per message). One misclick here messages every patient of the day — the guardrails are the feature.

## Task 17: Waitlist
**Description:** `WaitlistEntry` model (3c schema). Staff adds patient to waitlist per service/preferred dates. Subscribes to the **slot-freed event** from `releaseSlot()` (Task 5) — so it fires on BOTH staff cancellations (Task 14) AND self-service cancellations (Task 8). Notifies eligible entries via SMS; sets `notifiedAt` to prevent re-notification. Routes: `GET/POST /api/admin/waitlist`, `DELETE /api/admin/waitlist/[id]`.
**Acceptance criteria:**
- [ ] Staff adds patient to waitlist
- [ ] Cancellation (staff OR self-service) triggers notification to eligible waitlist entries
- [ ] `notifiedAt` set on notification; same entry not re-notified
- [ ] Claimed slot removes/ deactivates waitlist entry
- [ ] Auto-expired PENDING bookings (Task 9) also trigger waitlist notification — same `releaseSlot()` path, no extra code
- [ ] Waitlist offers are non-transactional: opted-out patients are not messaged
- [ ] Integration test: cancel via self-service link → waitlist SMS fires for matching entries
**Verification:** Manual: cancel both ways → waitlist SMS fired; `npm test -- waitlist`.
**Dependencies:** Task 14, Task 8 (to verify self-service path triggers it)
**Estimated scope:** Medium (2 days)
**Skill:** No specialized skill needed — an event subscriber over the existing `releaseSlot()` emitter. On the cut list if time runs short; nothing else depends on it.

## Task 18: KPIs overview
**Description:** Today's schedule, utilization rate, no-shows, new patients/month on dashboard home. Computed from appointments (no extra tables). Routes: `GET /api/admin/kpis?from=&to=`.
**Acceptance criteria:**
- [ ] Numbers computed from appointments (not stored)
- [ ] Correct per date range; renders on dashboard home
- [ ] Date ranges evaluated in **clinic-local** time, so "today" means the clinic's today, not UTC's
- [ ] KPIs cover the success metrics in plan.md: online booking share, median time-to-confirmation, no-show rate, utilization, auto-expiry rate
- [ ] Unit tests on aggregation functions (seeded data → expected numbers)
**Verification:** Manual vs seeded data; `npm test -- kpis`.
**Dependencies:** Task 14
**Estimated scope:** Medium (2 days)
**Skill:** A **SQL aggregation / analytics** skill if the queries get heavy; otherwise none. Keep the aggregations pure so they stay unit-testable, as plan.md specifies.

## Task 19: CSV/Excel export
**Description:** Monthly activity report (appointments, patients, statuses) as CSV and XLSX download, plus a **printable day sheet** (`GET /api/admin/exports/day-sheet?date=`) that gives staff a paper fallback if the site is unreachable during clinic hours. An export is a bulk extract of patient data: ADMIN-only, audited with row count and date range, clinical notes excluded unless explicitly requested. Route: `GET /api/admin/exports/appointments?month=&format=csv|xlsx`.
**Acceptance criteria:**
- [ ] Export reflects correct data for chosen month
- [ ] CSV and XLSX both downloadable
- [ ] **ADMIN-only** route (not merely staff-only); every export audited as `EXPORT_GENERATED` with row count
- [ ] Clinical notes excluded by default
- [ ] Day sheet prints legibly on one page
**Verification:** Download + open in spreadsheet app; compare to KPI numbers; confirm a receptionist account is refused; print the day sheet.
**Dependencies:** Task 18
**Estimated scope:** Small (1 day)
**Skill:** The available **xlsx** skill covers spreadsheet generation directly — use it rather than hand-rolling XLSX output.

## Task 20: Team management
**Description:** Admin creates/edits/deactivates receptionist accounts and issues one-time password resets. Deactivation and reset both bump `tokenVersion` (revoking live sessions); a reset also sets `mustChangePassword`. There is deliberately **no public "forgot password" email flow** — fewer moving parts, smaller attack surface, and it matches how a small clinic actually operates. Routes: `GET/POST /api/admin/team`, `PATCH /api/admin/team/[id]`, `POST /api/admin/team/[id]/reset-password`.
**Acceptance criteria:**
- [ ] Admin can create receptionist
- [ ] Deactivated staff cannot log in; live session revoked
- [ ] Admin can issue a password reset; the staff member must set a new password at next login
- [ ] Only ADMIN sees this section (route + nav gated)
- [ ] Account creation, deactivation, role change and password reset all audited
**Verification:** Manual; role check test.
**Dependencies:** Task 12
**Estimated scope:** Small (1–2 days)
**Skill:** Same **auth / RBAC** skill as Task 12 — no new one needed.

## Task 21: Content management + settings
**Description:** CRUD for services (incl. durations), gallery, testimonials, FAQ; working hours/slot config; **closure dates** (holidays, Eid, vacation, emergency closures); booking policy (lead time, horizon, PENDING expiry); messaging templates. Adding a closure that covers existing appointments shows the affected list and offers bulk cancel-and-notify or reschedule — appointments are never dropped silently. Routes under `/api/admin/services`, `/testimonials`, `/faqs`, `/gallery`, `/settings`, `/closures`.
**Acceptance criteria:**
- [ ] Each content type editable; reflects on public site (Task 11 pages)
- [ ] Service duration changes affect slot engine
- [ ] Working hours changes affect slot generation
- [ ] Closure dates block new bookings on those days and surface affected existing appointments for a staff decision
- [ ] Booking-policy settings (lead time, horizon, PENDING expiry) take effect in the slot engine and the expiry cron
- [ ] Messaging templates editable; used by SMS Center (Task 16)
- [ ] ADMIN-only; every settings and closure change audited
**Verification:** Manual edit → check public page + slots + template render; add a closure covering a booked day and confirm the affected list appears.
**Dependencies:** Task 12, Task 3b
**Estimated scope:** Medium (3–4 days)
**Skill:** No specialized skill needed — CRUD plus careful UI copy, since the clinic owner will use this unaided. Worth writing the screens in plain language rather than technical labels.

## Checkpoint: After Tasks 16-21 (Admin ops complete)
- [ ] SMS center + waitlist + KPIs + exports working
- [ ] Broadcast preview shows recipient count; double-submit sends once; opted-out patients excluded
- [ ] Waitlist fires on self-service cancellation **and** on auto-expiry (verified)
- [ ] Closure dates block bookings and surface affected appointments
- [ ] Team + content + settings manageable; password reset works end-to-end
- [ ] Role restrictions enforced (receptionist cannot manage team/settings/broadcasts/exports/audit)
- [ ] Review with human before proceeding

## Phase 6: Production Readiness

## Task 22: Twilio + WhatsApp provider wiring
**Description:** Activate `TwilioProvider` + `WhatsAppProvider` (env-gated). Verify real SMS/WhatsApp against a test DZ number **in staging** (provisioned in Task 1). Confirm provider swap is clean (no code changes beyond env). ⚠ **WhatsApp has an external lead time:** Meta requires documented patient opt-in and pre-approved message templates — submit them early in Phase 3, or launch SMS-only and add WhatsApp afterwards.
**Acceptance criteria:**
- [ ] `MESSAGE_PROVIDER=twilio` sends real SMS to DZ number
- [ ] `MESSAGE_PROVIDER=whatsapp` sends real WhatsApp
- [ ] Reminders + no-show + expiry cron (Task 9) fire via real provider
- [ ] SmsMessage records provider + status correctly for real sends
- [ ] Per-message cost confirmed for DZ numbers, and an alert configured for unusual send volume
- [ ] WhatsApp templates approved (or WhatsApp explicitly deferred, written down as a decision)
**Verification:** Staged test with real number; cron dry-run in staging.
**Dependencies:** Task 16, staging environment from Task 1
**Estimated scope:** Medium (2–3 days, plus external template-approval wait)
**Skill:** Same **messaging-provider** skill as Task 7, with emphasis on the WhatsApp Business template-approval process — that is the part with a calendar dependency rather than a coding one.

## Task 23: SEO, performance, Sentry, deploy + handoff
**Description:** SEO (**hreflang across the 3 locales, 301 redirects from every existing clinicorthocare.com URL, `Dentist`/`MedicalBusiness` JSON-LD with address, geo and opening hours, canonical URLs**), OG tags, per-locale sitemaps, robots.txt, performance pass (Arabic font subsetting, gallery image optimization, caching/ISR, bundle budget), security headers + CSP, Sentry with PII scrubbing, uptime and cron alerting, **a tested database restore**, launch cutover with rollback, deploy to Vercel, env vars, handoff docs.
**Acceptance criteria:**
- [ ] `hreflang` tags correct across all 3 locales (without them Google may treat the locales as duplicate pages)
- [ ] **301 redirects live from every old URL** — replacing a live site without them discards its accumulated ranking
- [ ] JSON-LD validates in Google's Rich Results test; name/address/phone match the Google Business Profile
- [ ] SEO tags + per-locale sitemaps present and submitted
- [ ] Lighthouse: performance ≥ 80 on **mobile** (throttled), accessibility ≥ 90; booking wizard usable by keyboard alone
- [ ] Security headers live: CSP (Google embed allow-listed), HSTS, `frame-ancestors 'none'`, `Referrer-Policy`, `nosniff`
- [ ] Sentry captures errors in prod with `sendDefaultPii: false`, request bodies stripped and self-service tokens masked
- [ ] Uptime check on the public site and `/api/health`; alert if a cron job stops reporting or sends start failing
- [ ] **Database restore performed from backup at least once** — an untested backup is not a backup
- [ ] Cutover plan written (DNS switch, old site kept reachable until verified, rollback = revert DNS)
- [ ] Retention policy and processor list written into the handoff docs
- [ ] Deployed to Vercel; all env vars configured
- [ ] Handoff docs written for clinic owner (admin login, content editing, closures, SMS provider, what to do if the site is down)
**Verification:** Lighthouse run on throttled mobile; live URL check; redirect spot-check on 5+ old URLs; Sentry test error with a fake patient name confirming it is scrubbed; restore drill; handoff doc review with the clinic owner.
**Dependencies:** Task 21, Task 22
**Estimated scope:** Large (3–4 days)
**Skill:** An **SEO skill for local businesses / multilingual sites** (hreflang, JSON-LD, migration redirects) — the highest-leverage one here, since discoverability is a core goal and this is a domain replacement. A **web-performance** skill for the mobile pass. The available **docx** skill is useful if the clinic owner wants the handoff guide as a Word document rather than markdown.

## Checkpoint: After Tasks 22-23 (Production)
- [ ] All acceptance criteria met
- [ ] Deployed with real SMS/WhatsApp verified against DZ number
- [ ] Sentry live with PII scrubbed; uptime + cron alerts firing
- [ ] Lighthouse acceptable on throttled mobile; 301 redirects and hreflang verified
- [ ] Database restore tested; day-sheet paper fallback printable
- [ ] Privacy notice published; retention policy and processor list handed over
- [ ] Final review + handoff

---

## Project-wide skills shortlist

The skills worth having *before* you start, roughly in order of how much they change the outcome:

1. **Auth / RBAC / session security** *(+ a security-review or threat-modeling skill)* — needed for Task 12, but it shapes every task that touches patient data. If you install only one thing, install this.
2. **Prisma / relational data modeling** — Tasks 3a and 3b. Schema decisions are inherited by all 23 tasks and are the most expensive to reverse.
3. **Date/time and timezone handling** — Task 4, the highest-risk task on the critical path. Silent one-hour drift is the classic failure of every scheduling system.
4. **Messaging-provider integration (Twilio / WhatsApp Business)** — Tasks 7, 16, 22. The provider's rules (E.164, opt-in, template approval) are most of the work.
5. **Database transactions / concurrency** — Task 5. A subtle mistake here double-books real patients.
6. **frontend-design** *(already available)* — Tasks 2, 6, 11, 14. The booking wizard and the receptionist day view are used daily; speed of use matters more than polish.
7. **File-upload security** — Task 15. X-rays are the most sensitive data in the system.
8. **SEO for local, multilingual businesses** — Tasks 11 and 23. Discoverability is a stated goal, and this is a live-domain replacement where redirects and hreflang decide whether existing ranking survives.
9. **Testing strategy (Vitest, integration, authorization matrices)** — applies throughout; the authorization matrix test is the highest-value single test in the project.
10. **xlsx** *(already available)* — Task 19. **docx** *(already available)* — Task 23 handoff guide, if the clinic owner wants Word.

Also available and already used to shape this plan: **write-spec** (goals, non-goals, acceptance criteria) and **sprint-planning** (estimates, critical path, capacity, definition of done). **skill-creator** is worth a look later — once your conventions settle, a small house skill capturing this project's patterns (audit calls, Zod placement, authorization guard, clinic-time handling) will make every future task more consistent.