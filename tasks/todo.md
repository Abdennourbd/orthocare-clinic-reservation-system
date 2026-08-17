# Task List: Ortho'Care Clinic Website

Task details live in `tasks/plan.md`. This is the working checklist. Implement strictly in order — each task leaves a working system.

## Phase 1: Foundation

## Task 1: Scaffold project
**Description:** Initialize Next.js (App Router, TypeScript, Tailwind, ESLint), add Prisma + Postgres connection, CI build.
**Acceptance criteria:**
- [ ] `npm run dev` serves the app
- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] Prisma schema migrates against Postgres
- [ ] Basic layout renders
**Verification:** `npm run build` succeeds; `npx prisma migrate dev` succeeds; CI passes.
**Dependencies:** None
**Estimated scope:** Medium

## Task 2: i18n foundation + site shell
**Description:** Add `next-intl` with `fr`, `ar`, `en` locales, RTL support, locale switcher; build header, footer, hero, nav.
**Acceptance criteria:**
- [ ] All 3 locales render; Arabic uses RTL
- [ ] Locale switcher works and persists
- [ ] Site shell matches current clinic branding (colors, logo, hero)
**Verification:** Manual check across `/fr`, `/ar`, `/en`; typecheck passes.
**Dependencies:** Task 1
**Estimated scope:** Medium

## Checkpoint: After Tasks 1-2 (Foundation)
- [ ] All tests pass, build clean
- [ ] 3 locales + RTL working
- [ ] Review with human before proceeding

## Phase 2: Scheduling Engine

## Task 3: Core schema + seed
**Description:** Define User, Patient, Service (durationMinutes), Appointment (status lifecycle), Visit, PatientDocument, WaitlistEntry, SmsMessage, AuditLog, Testimonial, FaqItem, GalleryItem, Setting; migrate; seed from current site.
**Acceptance criteria:**
- [ ] All models defined and migrated
- [ ] Status enum covers PENDING/CONFIRMED/COMPLETED/NO_SHOW/CANCELLED/RESCHEDULED
- [ ] Seed data matches current clinic content; services have durations
**Verification:** `prisma migrate dev` + `prisma db seed` succeed.
**Dependencies:** Task 1
**Estimated scope:** Large — split if needed

## Task 4: Slot engine (pure logic)
**Description:** Working hours lookup (per weekday from Settings), slot generation per service, overlap detection, availability query.
**Acceptance criteria:**
- [ ] `generateSlots(date, service)` returns candidate start times inside working hours
- [ ] Overlapping active appointments excluded from results
- [ ] Handles lunch break, inter-appointment buffer, day boundaries
**Verification:** Unit tests pass: `npm test -- slot-engine`; edge cases (boundaries, lunch, buffer).
**Dependencies:** Task 3
**Estimated scope:** Medium

## Task 5: Atomic booking action
**Description:** Transactional book: re-check availability inside transaction, insert Appointment, conflict → clear error, retry on race.
**Acceptance criteria:**
- [ ] Two concurrent bookings of same slot → exactly one succeeds
- [ ] Conflict returns a clear error, not a crash
- [ ] endTime computed from service duration
**Verification:** Concurrency unit test; `npm run typecheck`.
**Dependencies:** Task 4
**Estimated scope:** Medium

## Checkpoint: After Tasks 3-5 (Engine correct)
- [ ] Slot engine unit tests pass
- [ ] No double-booking under concurrency
- [ ] Review with human before proceeding

## Phase 3: Public Booking + Communication

## Task 6: Booking wizard UI
**Description:** Public flow: pick service → pick date → see available/occupied slots (occupied shown as reserved) → patient info → confirm → summary screen.
**Acceptance criteria:**
- [ ] Slots render as available/reserved correctly
- [ ] Booking creates a PENDING appointment via Task 5 action
- [ ] Summary screen shows appointment details
**Verification:** Manual end-to-end booking; conflict shows error.
**Dependencies:** Task 5
**Estimated scope:** Medium

## Task 7: Message abstraction + providers
**Description:** MessageProvider interface, Mock + Twilio-ready + WhatsApp providers, SmsMessage audit table; confirmation SMS on booking + staff dashboard notification.
**Acceptance criteria:**
- [ ] Booking triggers message via provider (mock logs to DB)
- [ ] Provider selected by env (`MESSAGE_PROVIDER`)
- [ ] Staff notification recorded; SmsMessage history queryable
**Verification:** Manual booking shows message log; unit test on provider interface.
**Dependencies:** Task 6
**Estimated scope:** Medium

## Task 8: Self-service link (cancel + reschedule)
**Description:** Signed token in confirmation SMS; public page to cancel appointment or reschedule into available slots.
**Acceptance criteria:**
- [ ] Token verifies (server-secret signed, expiry enforced)
- [ ] Cancel frees the slot; reschedule only into available slots
- [ ] Actions audited + SMS confirmation sent on change
**Verification:** Manual: book → open link → cancel/reschedule → slot availability reflects change.
**Dependencies:** Task 7
**Estimated scope:** Medium

## Task 9: Google Reviews embed
**Description:** Official Google Reviews embed widget on public site (live 4.8★/37 reviews).
**Acceptance criteria:**
- [ ] Widget renders on public page
- [ ] Works across locales
**Verification:** Manual check on public site.
**Dependencies:** Task 2
**Estimated scope:** Small

## Checkpoint: After Tasks 6-9 (Public booking + comms work)
- [ ] Public booking flow works end-to-end
- [ ] Confirmation + self-service verified
- [ ] Google Reviews widget live
- [ ] Review with human before proceeding

## Phase 4: Admin Core

## Task 10: Auth + RBAC + audit + dashboard shell
**Description:** Staff login (email/password), sessions, middleware-protected `/admin`; dashboard shell; role-based access (ADMIN vs RECEPTIONIST); audit log of staff actions.
**Acceptance criteria:**
- [ ] Unauthenticated users redirected from /admin
- [ ] Login validates; roles gate views (receptionist cannot see team/settings)
- [ ] Staff actions written to AuditLog
**Verification:** Manual auth flow; typecheck; security review of session handling.
**Dependencies:** Task 7
**Estimated scope:** Medium

## Task 11: Appointment management
**Description:** Day view of appointments; confirm-after-call, cancel, reschedule (re-checks availability), mark completed/no-show, manual booking creation.
**Acceptance criteria:**
- [ ] Receptionist can change status; SMS fires + action audited on each change
- [ ] Reschedule re-checks slot availability
- [ ] Manual booking creates CONFIRMED appointment that blocks its slot
**Verification:** Manual admin flow end-to-end.
**Dependencies:** Task 10
**Estimated scope:** Medium

## Task 12: Patient records + duplicate detection
**Description:** Patient CRUD, visit history timeline, notes; flag duplicate patients (same phone/name) on create/edit.
**Acceptance criteria:**
- [ ] Admin creates/edits patient profile
- [ ] Visit history shows completed appointments; manual visits addable
- [ ] Duplicate match shown and must be acknowledged before saving
**Verification:** Manual CRUD; duplicate flag test.
**Dependencies:** Task 11
**Estimated scope:** Medium

## Task 13: Patient documents
**Description:** Vercel Blob upload/download for patient documents (X-rays, photos, files), patient-scoped, staff-only.
**Acceptance criteria:**
- [ ] Upload with type/size validation works
- [ ] Documents listed per patient, downloadable
- [ ] Non-staff access denied; docs scoped to owning patient
**Verification:** Manual upload/download; security check.
**Dependencies:** Task 12
**Estimated scope:** Medium

## Checkpoint: After Tasks 10-13 (Admin core complete)
- [ ] Staff auth + role gating + audit working
- [ ] Full booking lifecycle driven by receptionist
- [ ] Patients + documents + duplicates handled
- [ ] Review with human before proceeding

## Phase 5: Admin Ops

## Task 14: SMS Center
**Description:** Manual single SMS to a patient; broadcast to all appointments of a day with delay template ("delayed by X min"); send history with batchId.
**Acceptance criteria:**
- [ ] Single manual SMS sends and logs
- [ ] Broadcast sends to all today's appointments; logged with shared batchId
- [ ] Templates editable from Settings
**Verification:** Manual send/broadcast; check SmsMessage log.
**Dependencies:** Task 11, Task 12
**Estimated scope:** Medium

## Task 15: Waitlist
**Description:** Patients on waitlist per service/preferred dates; when a slot frees (cancellation), notify eligible entries via SMS.
**Acceptance criteria:**
- [ ] Staff adds patient to waitlist
- [ ] Cancellation triggers notification to eligible waitlist entries
- [ ] Claimed slot removed from waitlist
**Verification:** Manual: cancel → waitlist SMS fired for matching entries.
**Dependencies:** Task 11
**Estimated scope:** Medium

## Task 16: KPIs overview
**Description:** Today's schedule, utilization rate, no-shows, new patients/month on dashboard home.
**Acceptance criteria:**
- [ ] Numbers computed from appointments (not stored)
- [ ] Correct per date range; renders on dashboard home
**Verification:** Manual vs seeded data; unit test on aggregations.
**Dependencies:** Task 11
**Estimated scope:** Medium

## Task 17: CSV/Excel export
**Description:** Monthly activity report (appointments, patients, statuses) as CSV and XLSX download.
**Acceptance criteria:**
- [ ] Export reflects correct data for chosen month
- [ ] CSV and XLSX both downloadable
- [ ] Staff-only route
**Verification:** Download + open in spreadsheet app.
**Dependencies:** Task 16
**Estimated scope:** Small

## Task 18: Team management
**Description:** Admin creates/edits/deactivates receptionist accounts.
**Acceptance criteria:**
- [ ] Admin can create receptionist
- [ ] Deactivated staff cannot log in
- [ ] Only ADMIN sees this section
**Verification:** Manual; role check.
**Dependencies:** Task 10
**Estimated scope:** Small

## Task 19: Content management + settings
**Description:** CRUD for services (incl. durations), gallery, testimonials, FAQ; working hours/slot config; messaging templates.
**Acceptance criteria:**
- [ ] Each content type editable; reflects on public site
- [ ] Service duration changes affect slot engine
- [ ] Working hours changes affect slot generation
**Verification:** Manual edit → check public page + slots.
**Dependencies:** Task 10
**Estimated scope:** Medium

## Checkpoint: After Tasks 14-19 (Admin ops complete)
- [ ] SMS center + waitlist + KPIs + exports working
- [ ] Team + content + settings manageable
- [ ] Review with human before proceeding

## Phase 6: Production Readiness

## Task 20: Twilio + WhatsApp providers + reminder & no-show cron
**Description:** TwilioSmsProvider + WhatsAppProvider (env-gated); Vercel Cron for 24h-before reminders to CONFIRMED appointments and no-show follow-up SMS.
**Acceptance criteria:**
- [ ] `MESSAGE_PROVIDER=twilio` / `whatsapp` sends real messages
- [ ] Cron fires reminders + no-show follow-ups
- [ ] NO_SHOW status updated by follow-up flow
**Verification:** Staged test with real number; cron dry-run.
**Dependencies:** Task 14
**Estimated scope:** Medium

## Task 21: SEO, performance, deploy + handoff
**Description:** SEO/OG tags, sitemap, robots.txt, performance pass, deploy to Vercel, env vars, handoff docs.
**Acceptance criteria:**
- [ ] SEO tags + sitemap present
- [ ] Lighthouse scores acceptable
- [ ] Deployed; env vars configured; handoff docs written
**Verification:** Lighthouse run; live URL check.
**Dependencies:** Task 19, Task 20
**Estimated scope:** Medium

## Checkpoint: After Tasks 20-21 (Production)
- [ ] All acceptance criteria met
- [ ] Deployed with real messaging verified
- [ ] Final review + handoff