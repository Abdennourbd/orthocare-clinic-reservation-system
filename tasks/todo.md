# Task List: Ortho'Care Clinic Website

Task details + rationale live in `tasks/plan.md`. This is the working checklist. Implement strictly in order — each task leaves a working system.

**Testing approach:** Vitest + dedicated test Postgres DB. Every backend slice ships with a route-level integration test against the test DB, not just curl. Unit tests for pure logic. Manual verification for UI/i18n/RTL.

## Phase 1: Foundation

## Task 1: Scaffold project
**Description:** Initialize Next.js (App Router, TypeScript, Tailwind, ESLint) following the directory layout in `tasks/plan.md` → "Code Structure"; add Prisma + Postgres (dev + test DBs), Vitest, Zod, Vercel Blob env, GitHub Actions CI (build + lint + typecheck + test).
**Acceptance criteria:**
- [ ] `npm run dev` serves the app
- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] Prisma schema migrates against dev + test Postgres
- [ ] Basic layout renders
- [ ] CI passes on PR (GHA workflow exists)
- [ ] Vercel Blob env vars documented in `.env.example`
- [ ] Structure matches plan.md "Code Structure" section (src/ layout, middleware.ts, messages/, prisma/, tests/)
**Verification:** `npm run build` succeeds; `npx prisma migrate dev` + `prisma migrate deploy` against test DB succeed; CI green.
**Dependencies:** None
**Estimated scope:** Medium

## Task 2: i18n foundation + site shell + `localized()` helper
**Description:** Add `next-intl` with `fr`, `ar`, `en` locales, RTL support, locale switcher; build header, footer, hero, nav; deliver `localized(field, locale, fallback='fr')` helper for JSON per-locale DB fields, with unit tests.
**Acceptance criteria:**
- [ ] All 3 locales render; Arabic uses RTL
- [ ] Locale switcher works and persists (cookie)
- [ ] Site shell matches current clinic branding (colors, logo, hero)
- [ ] `localized()` returns the requested locale or falls back to FR; unit tests cover missing locale + null field
**Verification:** Manual check across `/fr`, `/ar`, `/en`; `npm test -- localized`; typecheck passes.
**Dependencies:** Task 1
**Estimated scope:** Medium

## Checkpoint: After Tasks 1-2 (Foundation)
- [ ] All tests pass, build clean, CI green
- [ ] 3 locales + RTL working
- [ ] `localized()` helper unit-tested
- [ ] Review with human before proceeding

## Phase 2: Scheduling Engine (no UI — highest risk first)

## Task 3a: Core schema (auth + patients + services + appointments)
**Description:** Define `User` (with tokenVersion), `Patient` (soft-delete, createdById/updatedById, indexed phone), `Service` (durationMinutes, currency, JSON per-locale, soft-delete), `Appointment` (status enum, nullable creator/confirmedBy, per-status timestamps); migrate; minimal seed (1 admin user, 2-3 services with durations, 1 patient) — just enough to test the engine.
**Acceptance criteria:**
- [ ] All 4 models defined and migrated
- [ ] `Appointment.status` covers PENDING/CONFIRMED/COMPLETED/NO_SHOW/CANCELLED/RESCHEDULED
- [ ] `createdByUserId` / `confirmedByUserId` are nullable
- [ ] `cancelledAt` / `completedAt` / `noShowAt` present
- [ ] Patient.phone indexed (non-unique)
- [ ] Minimal seed loads
**Verification:** `prisma migrate dev` + `prisma db seed` succeed; `npm test` (schema smoke test).
**Dependencies:** Task 1
**Estimated scope:** Medium

## Task 3b: Content schema + full seed
**Description:** Define `Testimonial`, `FaqItem`, `GalleryItem` (JSON per-locale, `active`), `Setting` (key, JSON value; working-hours schema documented); migrate; full seed from current clinicorthocare.com (services, testimonials, FAQ, default working hours Sat–Thu 10h–17h Fri closed, slot granularity, buffer).
**Acceptance criteria:**
- [ ] Content models + Setting defined and migrated
- [ ] Seed data matches current clinic content; services have durations
- [ ] Working-hours Setting seeded with documented JSON schema
- [ ] All per-locale fields populated in FR + AR + EN
**Verification:** `prisma migrate dev` + `prisma db seed` succeed; query seeded data in 3 locales.
**Dependencies:** Task 3a
**Estimated scope:** Medium

## Task 4: Slot engine (pure logic)
**Description:** Working hours lookup (per weekday from Settings), slot generation per service, overlap detection, availability query. Pure functions, no DB writes — only reads.
**Acceptance criteria:**
- [ ] `generateSlots(date, service)` returns candidate start times inside working hours
- [ ] Overlapping active appointments excluded from results
- [ ] Handles lunch break, inter-appointment buffer, day boundaries
- [ ] Respects Service.durationMinutes for slot length
**Verification:** Unit tests pass: `npm test -- slot-engine`; edge cases (boundaries, lunch, buffer, buffer-after-lunch, multi-service durations).
**Dependencies:** Task 3a (schema), Task 3b (Settings seed for working hours)
**Estimated scope:** Medium

## Task 5: Atomic booking action + `releaseSlot()`
**Description:** Transactional `bookSlot()` — re-check availability inside transaction, insert Appointment, conflict → clear error, retry on race. Also deliver `releaseSlot(appointmentId, reason)` shared domain function that cancels/frees an appointment and emits a **slot-freed event** (simple event emitter or in-process pub/sub; no waitlist subscriber yet — that's Task 17). Both exposed as testable server functions.
**Acceptance criteria:**
- [ ] Two concurrent bookings of same slot → exactly one succeeds
- [ ] Conflict returns a clear, typed error (not a crash)
- [ ] endTime computed from service duration
- [ ] `releaseSlot()` frees the slot and emits slot-freed event (verifiable in test)
- [ ] Reschedule = releaseSlot + bookSlot atomically
**Verification:** Concurrency unit test (Promise.all of N bookings on same slot → 1 success, N-1 typed errors); `npm run typecheck`.
**Dependencies:** Task 4
**Estimated scope:** Medium

## Checkpoint: After Tasks 3a-5 (Engine correct)
- [ ] Slot engine unit tests pass (overlap, boundaries, lunch, buffer)
- [ ] No double-booking under concurrency (automated test)
- [ ] `releaseSlot()` event fires on cancellation
- [ ] Review with human before proceeding

## Phase 3: Public Booking + Communication

## Task 6: Booking wizard UI + `POST /api/appointments` + `GET /api/slots`
**Description:** Vertical slice — public flow: pick service → pick date → see available/occupied slots (occupied shown as reserved) → patient info → confirm → summary screen. Backend routes: `GET /api/services`, `GET /api/services/[slug]`, `GET /api/slots`, `POST /api/appointments` (calls Task 5 `bookSlot`).
**Acceptance criteria:**
- [ ] Slots render as available/reserved correctly
- [ ] Booking creates a PENDING appointment via `bookSlot`
- [ ] Conflict shows a user-facing error (slot just taken)
- [ ] Summary screen shows appointment details
- [ ] Route-level integration test: happy path + conflict path
**Verification:** Manual end-to-end booking; `npm test -- booking`.
**Dependencies:** Task 5, Task 2 (i18n/shell)
**Estimated scope:** Medium

## Task 7: Message abstraction + providers + `SmsMessage` + `Notification`
**Description:** `MessageProvider` interface; `MockProvider` (logs to DB), `TwilioProvider` (stub, env-gated), `WhatsAppProvider` (stub, env-gated). Add `SmsMessage` + `Notification` models (3c schema). Confirmation SMS on booking + staff `Notification` row (NEW_BOOKING). Provider selected via `MESSAGE_PROVIDER` env.
**Acceptance criteria:**
- [ ] Booking triggers message via provider (mock logs to SmsMessage)
- [ ] Provider selected by env (`MESSAGE_PROVIDER=mock|twilio|whatsapp`)
- [ ] Staff `Notification` row created on new booking; queryable
- [ ] SmsMessage history queryable by patientId / batchId
**Verification:** Manual booking shows message log + notification; unit test on provider interface + dispatch.
**Dependencies:** Task 6
**Estimated scope:** Medium

## Task 8: Self-service link (cancel + reschedule)
**Description:** `SelfServiceToken` model (3c schema: revocable, expiresAt, usedAt). Token embedded in confirmation SMS. Public routes: `GET /api/appointments/[token]`, `POST .../cancel`, `POST .../reschedule`. Cancel and reschedule both route through `releaseSlot()` (Task 5) so the slot-freed event fires.
**Acceptance criteria:**
- [ ] Token verifies (not expired, not used, not revoked)
- [ ] Cancel frees the slot via `releaseSlot()`; token marked used
- [ ] Reschedule only into available slots; calls `releaseSlot()` + `bookSlot()`
- [ ] Actions audited + SMS confirmation sent on change
- [ ] Integration test: book → open link → cancel/reschedule → slot availability reflects change
**Verification:** Manual flow + `npm test -- self-service`.
**Dependencies:** Task 7, Task 5 (releaseSlot)
**Estimated scope:** Medium

## Task 9: Reminders + no-show follow-up cron (mock provider)
**Description:** Vercel Cron routes (CRON_SECRET auth): `/api/cron/reminders` (24h-before SMS to CONFIRMED appointments), `/api/cron/no-show-followup` (mark past CONFIRMED as NO_SHOW + send follow-up SMS). Uses mock provider for now; real wiring is Task 22.
**Acceptance criteria:**
- [ ] Cron routes reject without `CRON_SECRET` header
- [ ] Reminders fire for CONFIRMED appointments 24h out
- [ ] No-show follow-up marks NO_SHOW + sets `noShowAt` + sends SMS
- [ ] Dry-run against seeded data logs mock SMS correctly
**Verification:** `npm test -- cron`; manual trigger with seeded past/future appointments.
**Dependencies:** Task 7
**Estimated scope:** Medium

## Task 10: Google Reviews embed
**Description:** Official Google Reviews embed widget on public site (live rating).
**Acceptance criteria:**
- [ ] Widget renders on public page
- [ ] Works across all 3 locales
**Verification:** Manual check on public site in `/fr`, `/ar`, `/en`.
**Dependencies:** Task 2
**Estimated scope:** Small

## Task 11: Public content pages
**Description:** Build public-facing content pages: services list + detail, FAQ, testimonials, gallery, about, contact. All consume `localized()` helper (Task 2) + content schema (Task 3b).
**Acceptance criteria:**
- [ ] Each page renders in all 3 locales with FR fallback
- [ ] Services list links to detail; detail shows duration + description
- [ ] Gallery, testimonials, FAQ render active items only
- [ ] Contact page renders clinic info + map
**Verification:** Manual check across 3 locales; typecheck.
**Dependencies:** Task 2, Task 3b
**Estimated scope:** Medium

## Checkpoint: After Tasks 6-11 (Public booking + comms work end-to-end)
- [ ] Public booking flow works end-to-end
- [ ] Confirmation + self-service verified; `releaseSlot()` fires on self-service cancel
- [ ] Reminders + no-show cron run against seeded data (mock SMS)
- [ ] Google Reviews widget live in 3 locales
- [ ] Public content pages render in 3 locales
- [ ] Review with human before proceeding

## Phase 4: Admin Core

## Task 12: Auth + RBAC + audit helper + dashboard shell
**Description:** Staff login (email/password, signed session cookie with tokenVersion), middleware-protected `/admin`, dashboard shell (FR only), role-gated nav (ADMIN vs RECEPTIONIST), `logAction(userId, action, entityType, entityId, detail)` helper + `AuditLog` model (3c schema). Every later staff action calls `logAction`.
**Acceptance criteria:**
- [ ] Unauthenticated users redirected from `/admin`
- [ ] Login validates; roles gate views (receptionist cannot see team/settings routes)
- [ ] Deactivated staff (active=false) cannot log in; existing sessions revoked via tokenVersion bump
- [ ] `logAction()` writes to AuditLog with enum action + JSON detail
- [ ] Unit tests: auth gating per role, tokenVersion revocation
**Verification:** Manual auth flow; `npm test -- auth`; security review of session handling.
**Dependencies:** Task 3a (User schema) — **NOT** Task 7
**Estimated scope:** Medium

## Task 13: Patient records + duplicate detection
**Description:** Patient CRUD, visit history timeline (COMPLETED appointments UNION Visit rows), notes. Duplicate detection: on create/edit, query patients sharing phone or name; return warnings; require staff acknowledgment to proceed. `Visit` model (3c schema). Routes: `GET/POST /api/admin/patients`, `GET/PATCH /api/admin/patients/[id]`, `GET .../history`, `POST .../visits`.
**Acceptance criteria:**
- [ ] Admin creates/edits patient profile; `createdById`/`updatedById` set
- [ ] Visit history shows COMPLETED appointments + Visits in unified timeline
- [ ] Manual visit addable
- [ ] Duplicate match (phone or name) shown; save blocked until acknowledged
- [ ] Soft-delete only (active=false)
**Verification:** Manual CRUD + duplicate flag test; `npm test -- patient-duplicates`.
**Dependencies:** Task 12
**Estimated scope:** Medium

## Task 14: Appointment management
**Description:** Day view of appointments; confirm-after-call, cancel, reschedule (re-checks availability via Task 5), mark completed/no-show, manual booking creation (CONFIRMED, blocks slot). All status changes set the matching timestamp (`confirmedAt`/`cancelledAt`/`completedAt`/`noShowAt`), call `logAction`, and fire SMS. Routes: `GET/POST /api/admin/appointments`, `GET/PATCH .../[id]`, `POST .../[id]/reschedule`.
**Acceptance criteria:**
- [ ] Receptionist changes status; SMS fires + action audited on each change
- [ ] Reschedule re-checks slot availability via `bookSlot`
- [ ] Manual booking creates CONFIRMED appointment that blocks its slot
- [ ] Cancel/reschedule route through `releaseSlot()` (so waitlist fires later)
- [ ] Per-status timestamps set correctly
**Verification:** Manual admin flow end-to-end; integration test on status transitions.
**Dependencies:** Task 13 (manual booking needs patient CRUD), Task 5
**Estimated scope:** Medium

## Task 15: Patient documents
**Description:** `PatientDocument` model (3c schema). Vercel Blob upload/download, patient-scoped, staff-only. Routes: `POST /api/admin/patients/[id]/documents`, `GET .../documents`, `GET /api/admin/documents/[id]`, `DELETE ...`.
**Acceptance criteria:**
- [ ] Upload with type/size validation works (Vercel Blob)
- [ ] Documents listed per patient, downloadable via signed URL
- [ ] Non-staff access denied; docs scoped to owning patient
- [ ] Delete removes blob + DB row
**Verification:** Manual upload/download; security check (non-staff → 403); `npm test -- documents`.
**Dependencies:** Task 13
**Estimated scope:** Medium

## Checkpoint: After Tasks 12-15 (Admin core complete)
- [ ] Staff auth + role gating + audit working; session revocation tested
- [ ] Full booking lifecycle driven by receptionist, all actions audited
- [ ] Patients + documents + duplicates handled
- [ ] Review with human before proceeding

## Phase 5: Admin Ops

## Task 16: SMS Center
**Description:** Manual single SMS to a patient; broadcast to all appointments of a day with delay template ("delayed by X min"); send history with shared `batchId`. Routes: `POST /api/admin/sms/single`, `POST /api/admin/sms/broadcast`, `GET /api/admin/sms`, `GET /api/admin/sms/batches`.
**Acceptance criteria:**
- [ ] Single manual SMS sends and logs (SmsMessage with patientId)
- [ ] Broadcast sends to all today's appointments; logged with shared batchId
- [ ] Delay template renders ("Your appointment today is delayed by X min")
- [ ] Templates editable from Settings (Task 21)
- [ ] Broadcast permission: admin-only (receptionist blocked)
**Verification:** Manual send/broadcast; check SmsMessage log; role-gating test.
**Dependencies:** Task 14, Task 13
**Estimated scope:** Medium

## Task 17: Waitlist
**Description:** `WaitlistEntry` model (3c schema). Staff adds patient to waitlist per service/preferred dates. Subscribes to the **slot-freed event** from `releaseSlot()` (Task 5) — so it fires on BOTH staff cancellations (Task 14) AND self-service cancellations (Task 8). Notifies eligible entries via SMS; sets `notifiedAt` to prevent re-notification. Routes: `GET/POST /api/admin/waitlist`, `DELETE /api/admin/waitlist/[id]`.
**Acceptance criteria:**
- [ ] Staff adds patient to waitlist
- [ ] Cancellation (staff OR self-service) triggers notification to eligible waitlist entries
- [ ] `notifiedAt` set on notification; same entry not re-notified
- [ ] Claimed slot removes/ deactivates waitlist entry
- [ ] Integration test: cancel via self-service link → waitlist SMS fires for matching entries
**Verification:** Manual: cancel both ways → waitlist SMS fired; `npm test -- waitlist`.
**Dependencies:** Task 14, Task 8 (to verify self-service path triggers it)
**Estimated scope:** Medium

## Task 18: KPIs overview
**Description:** Today's schedule, utilization rate, no-shows, new patients/month on dashboard home. Computed from appointments (no extra tables). Routes: `GET /api/admin/kpis?from=&to=`.
**Acceptance criteria:**
- [ ] Numbers computed from appointments (not stored)
- [ ] Correct per date range; renders on dashboard home
- [ ] Unit tests on aggregation functions (seeded data → expected numbers)
**Verification:** Manual vs seeded data; `npm test -- kpis`.
**Dependencies:** Task 14
**Estimated scope:** Medium

## Task 19: CSV/Excel export
**Description:** Monthly activity report (appointments, patients, statuses) as CSV and XLSX download. Route: `GET /api/admin/exports/appointments?month=&format=csv|xlsx`.
**Acceptance criteria:**
- [ ] Export reflects correct data for chosen month
- [ ] CSV and XLSX both downloadable
- [ ] Staff-only route
**Verification:** Download + open in spreadsheet app; compare to KPI numbers.
**Dependencies:** Task 18
**Estimated scope:** Small

## Task 20: Team management
**Description:** Admin creates/edits/deactivates receptionist accounts. Deactivation bumps `tokenVersion` (revokes sessions). Routes: `GET/POST /api/admin/team`, `PATCH /api/admin/team/[id]`.
**Acceptance criteria:**
- [ ] Admin can create receptionist
- [ ] Deactivated staff cannot log in; live session revoked
- [ ] Only ADMIN sees this section (route + nav gated)
**Verification:** Manual; role check test.
**Dependencies:** Task 12
**Estimated scope:** Small

## Task 21: Content management + settings
**Description:** CRUD for services (incl. durations), gallery, testimonials, FAQ; working hours/slot config; messaging templates. Routes under `/api/admin/services`, `/testimonials`, `/faqs`, `/gallery`, `/settings`.
**Acceptance criteria:**
- [ ] Each content type editable; reflects on public site (Task 11 pages)
- [ ] Service duration changes affect slot engine
- [ ] Working hours changes affect slot generation
- [ ] Messaging templates editable; used by SMS Center (Task 16)
- [ ] ADMIN-only
**Verification:** Manual edit → check public page + slots + template render.
**Dependencies:** Task 12, Task 3b
**Estimated scope:** Medium

## Checkpoint: After Tasks 16-21 (Admin ops complete)
- [ ] SMS center + waitlist + KPIs + exports working
- [ ] Waitlist fires on self-service cancellation (verified)
- [ ] Team + content + settings manageable
- [ ] Role restrictions enforced (receptionist cannot manage team/settings/broadcasts)
- [ ] Review with human before proceeding

## Phase 6: Production Readiness

## Task 22: Twilio + WhatsApp provider wiring
**Description:** Activate `TwilioProvider` + `WhatsAppProvider` (env-gated). Verify real SMS/WhatsApp against a test DZ number. Confirm provider swap is clean (no code changes beyond env).
**Acceptance criteria:**
- [ ] `MESSAGE_PROVIDER=twilio` sends real SMS to DZ number
- [ ] `MESSAGE_PROVIDER=whatsapp` sends real WhatsApp
- [ ] Reminders + no-show cron (Task 9) fire via real provider
- [ ] SmsMessage records provider + status correctly for real sends
**Verification:** Staged test with real number; cron dry-run in staging.
**Dependencies:** Task 16
**Estimated scope:** Medium

## Task 23: SEO, performance, Sentry, deploy + handoff
**Description:** SEO/OG tags, sitemap, robots.txt, performance pass, Sentry error monitoring, deploy to Vercel, env vars, handoff docs.
**Acceptance criteria:**
- [ ] SEO tags + sitemap present (per-locale)
- [ ] Lighthouse scores acceptable (performance ≥ 80, accessibility ≥ 90)
- [ ] Sentry captures errors in prod
- [ ] Deployed to Vercel; all env vars configured
- [ ] Handoff docs written for clinic owner (admin login, content editing, SMS provider)
**Verification:** Lighthouse run; live URL check; Sentry test error; handoff doc review.
**Dependencies:** Task 21, Task 22
**Estimated scope:** Medium

## Checkpoint: After Tasks 22-23 (Production)
- [ ] All acceptance criteria met
- [ ] Deployed with real SMS/WhatsApp verified against DZ number
- [ ] Sentry live; Lighthouse acceptable
- [ ] Final review + handoff
