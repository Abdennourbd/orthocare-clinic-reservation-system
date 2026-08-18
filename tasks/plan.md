# Implementation Plan: Ortho'Care Clinic — New Website

## Overview

A from-scratch replacement for clinicorthocare.com: a trilingual (FR / AR / EN, Arabic RTL) public site for an orthodontics clinic in Algiers, with a **real slot-based online reservation system** and a **role-based admin dashboard**.

Patients book online: they pick a consultation type (cleaning, checkup, orthodontics, etc. — each with an estimated duration), see the day's **available time slots** (already-booked slots render as reserved), and pick one to reserve. A **phone call by the receptionist is required to confirm** an online booking. Confirmation SMS includes a **self-service link** to cancel or reschedule into an available slot.

The dashboard has two roles — **admin** and **receptionist** (created by admin). Staff manage reservations (confirm/cancel/reschedule after phone calls), add manual bookings, manage patient records (profile, visit history, uploaded documents), and send SMS: single messages or **broadcasts** (e.g., "today's appointments delayed by 30 min"). Every completed patient visit is saved as history. Patients do **not** log in — their record is admin-managed only.

The scheduling engine (slot generation, overlap detection, atomic conflict-free booking) is the heavy part of the backend and is built and tested first.

## Confirmed Feature Set

| # | Feature | Status |
|---|---------|--------|
| — | Slot-based booking with per-service durations | Core |
| — | RBAC admin dashboard (admin + receptionist) | Core |
| — | SMS center: single + broadcast with delay template | Core |
| 1 | **WhatsApp** as full provider behind the same abstraction as SMS | In |
| 2 | **Google Reviews** embed widget on public site | In |
| 3 | **Self-service link** in confirmation SMS: cancel + reschedule | In |
| 5 | **KPIs** dashboard (schedule, utilization, no-shows, new patients) | In |
| 7 | **Waitlist** — notify patients when a slot frees | In |
| 8 | **No-show follow-up** SMS (automatic, cron) | In |
| 9 | **CSV/Excel export** of monthly activity | In |
| 10 | **Duplicate patient detection** (same phone/name) | In |
| 4 | Patient intake form | Dropped |
| 6 | Recall campaigns | Dropped |

## Architecture Decisions

- **Stack:** Next.js (App Router) + TypeScript + Tailwind CSS. One codebase for public site, API, and dashboard. No separate backend.
- **Database:** Postgres via Prisma ORM (Vercel Postgres or Neon).
- **i18n:** `next-intl`. Locales `fr`, `ar`, `en` with Arabic RTL + locale switcher. DB-driven content uses per-locale fields.
- **Messaging:** `MessageProvider` interface. Implementations: `MockProvider` (logs to DB, dev), `TwilioProvider` (SMS, prod), `WhatsAppProvider` (prod, same templates). Selected via env. Every message recorded in `SmsMessage` with a `batchId` for broadcasts. Templates stored in Settings.
- **Auth/RBAC:** staff users with roles `ADMIN` and `RECEPTIONIST`. Email/password, signed session cookie, middleware-protected `/admin` routes. Patients have **no login**. Every staff action (confirm, cancel, reschedule, SMS, patient edit) written to an **audit trail**.
- **Reservation model (slot-based):**
  - Each `Service` has `durationMinutes` (estimation time per consultation type).
  - `generateSlots(date, service)` → candidate start times inside working hours (configurable granularity, buffer, lunch break), minus overlap with existing active appointments.
  - Booking is **atomic**: availability re-checked inside a DB transaction before insert; conflicts return an error. Production-hardening option: Postgres range EXCLUDE constraint via raw SQL.
  - Status lifecycle: `PENDING` (online, awaiting phone call) → `CONFIRMED` (after call) → `COMPLETED` / `NO_SHOW` / `CANCELLED` / `RESCHEDULED`. Manual (phone) bookings can be created directly as `CONFIRMED`.
- **Self-service link:** signed token (no DB row) embedded in confirmation SMS. Grants limited actions: cancel an appointment, or reschedule into an available slot. Signed with server secret, expires.
- **Google Reviews:** official embed widget on the public site (no API key, live rating/reviews).
- **Waitlist:** `WaitlistEntry` per patient/service. When a slot frees (cancellation), eligible waitlist entries are notified via SMS.
- **KPIs & exports:** computed on demand from appointments (no extra tables). CSV and XLSX generation in `lib/export`.
- **Duplicate detection:** on patient creation/edit, flag existing patients sharing phone or name; requires staff acknowledgment to proceed.
- **Working hours / Settings:** store open hours per weekday (Sat–Thu, 10h–17h; Fri closed), slot granularity, inter-appointment buffer — editable in dashboard.
- **Patients:** admin-managed accounts — profile (name, phone, email, birth date, notes), visit history (from appointments + manual visit records), uploaded documents.
- **Documents:** patient documents (X-rays, photos, files) in Vercel Blob; metadata in DB, patient-scoped, staff-only access.
- **Admin dashboard language: FR only.** Public site is trilingual (FR/AR/EN). Dashboard UI, labels, and validation messages are FR-only. Rationale: staff are local; trilingual admin UI doubles the dashboard effort for no audience. Decided — no longer an open question.
- **i18n of DB-driven content:** per-locale fields stored as **JSON columns** (`name: {fr, ar, en}`, `description: {fr, ar, en}`). Helper `localized(field, locale, fallback='fr')` centralizes retrieval with FR fallback. Owned by Task 2 (helper) + Task 3b (schema). Avoids a translation table for 3 locales + short strings; Postgres JSON ops support queries if needed.
- **Testing strategy:** Vitest + a dedicated test Postgres database.
  - **Unit tests (required):** slot engine (Task 4), atomic booking concurrency (Task 5), audit helper, auth/RBAC gating (Task 12), booking wizard happy + conflict paths (Task 6), KPI aggregations (Task 18), duplicate detection (Task 13).
  - **Integration tests (required):** booking lifecycle (PENDING→CONFIRMED→COMPLETED), self-service cancel/reschedule, waitlist notification on cancellation.
  - **Manual verification:** visual UI, i18n/RTL rendering, real SMS in staging.
  - Every backend slice is tested with a route-level integration test against the test DB, not just curl.
- **Audit logging:** a shared `logAction(userId, action, entityType, entityId, detail)` helper is delivered in Task 12 (auth) and called by Tasks 13–21. `action` is an enum (`APPOINTMENT_CONFIRMED`, `PATIENT_CREATED`, `SMS_SENT`, etc.), `detail` is JSON for context. Later tasks call the helper; they do not re-implement audit.
- **Shared slot-release function:** a `releaseSlot(appointmentId, reason)` domain function is introduced in Task 5 and called by every path that frees a slot (staff cancel in Task 14, self-service cancel in Task 8, reschedule). It emits a **slot-freed event** that Task 17 (waitlist) subscribes to. This makes waitlist notifications fire on *all* cancellations, not just staff-driven ones.
- **CI:** GitHub Actions — build, lint, typecheck, test on every PR; `prisma migrate` + seed against a ephemeral test DB.
- **Error monitoring:** Sentry in production (added to Task 23) — patient-adjacent data warrants observability.
- **Vercel Blob:** configured in Task 1 (env + dependency), consumed in Task 15 (patient documents).
- **Deployment:** Vercel + managed Postgres + Vercel Blob + Vercel Cron (reminders, no-show follow-up). Seed data migrated from the current site (services, testimonials, FAQ).

## Domain / Data Model

Per-locale fields are JSON columns (`{fr, ar, en}`); see `localized()` helper in Architecture Decisions.

- `User` — id, name, email, passwordHash, role (`ADMIN`|`RECEPTIONIST`), active, **tokenVersion** (int; bumped on deactivate to revoke live sessions), timestamps
- `Patient` — id, firstName, lastName, phone (indexed, non-unique — for duplicate detection, not a constraint), email, birthDate, notes, **createdById** (nullable FK→User), **updatedById** (nullable FK→User), timestamps. **Soft-delete only** (`active=false`); never hard-delete (historical appointments reference it).
- `Service` — id, slug, name (JSON per-locale), description (JSON per-locale), durationMinutes, price (optional), **currency** (default `DZD`), active. Soft-delete only.
- `Appointment` — id, patientId, serviceId, startTime, endTime (= start + service.duration), status (`PENDING`|`CONFIRMED`|`COMPLETED`|`NO_SHOW`|`CANCELLED`|`RESCHEDULED`), source (`ONLINE`|`MANUAL`), **createdByUserId** (nullable — null for ONLINE bookings), **confirmedAt**/**confirmedByUserId** (nullable — null if never confirmed), **cancelledAt**, **completedAt**, **noShowAt**, visitNotes, timestamps. Timestamps per status make KPI queries cheap (no AuditLog walk).
- `Visit` — manual history records: id, patientId, date, serviceId?, type, notes, treatment. **History = `COMPLETED` appointments UNION `Visit` rows.** Visits are for pre-system records or walk-in treatments that never had an appointment. Documented in schema.
- `PatientDocument` — id, patientId, name, type, url, uploadedById, uploadedAt
- `WaitlistEntry` — id, patientId, serviceId, preferredDates (**DateTime[]**), active, **notifiedAt** (nullable — prevents re-notifying on every cancellation), createdAt
- `SmsMessage` — id, to, body, **patientId** (nullable — enables "messages for this patient" queries without phone matching), type (`CONFIRMATION`|`REMINDER`|`NO_SHOW`|`MANUAL`|`RESCHEDULE`|`DELAY`|`WAITLIST` — note: no `BROADCAST`; grouping is encoded by `batchId`), **templateId** (nullable — lineage to the template version), batchId, provider, status, appointmentId?, sentById, sentAt
- `AuditLog` — id, userId, **action** (enum: `APPOINTMENT_CONFIRMED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_COMPLETED`, `APPOINTMENT_NO_SHOW`, `PATIENT_CREATED`, `PATIENT_UPDATED`, `SMS_SENT`, `PATIENT_DOCUMENT_UPLOADED`, `TEAM_MEMBER_CREATED`, `TEAM_MEMBER_DEACTIVATED`, `SETTINGS_UPDATED`, `WAITLIST_ENTRY_ADDED`), entityType, entityId, detail (JSON), createdAt
- `Notification` *(new)* — staff in-app notification feed: id, userId, type (`NEW_BOOKING`|`CANCELLATION`|`WAITLIST_MATCH`|`NO_SHOW_ALERT`), payload (JSON), readAt, createdAt. Backs the dashboard notification center; without it, "staff notification" is hand-waved.
- `SelfServiceToken` *(new, optional but recommended)* — id, appointmentId, usedAt, revokedAt, expiresAt. Replaces stateless signed token to give revocation + replay protection. Small cost; worth it for medical-adjacent data. If you keep stateless tokens, enforce ≤48h expiry.
- `Testimonial`, `FaqItem`, `GalleryItem` — public content, JSON per-locale fields, `active`
- `Setting` — key, **value (JSON string)**. Working-hours schema documented: `{mon:{open:"10:00",close:"17:00"}, tue:{...}, ... fri:{closed:true}, sat:{...}}`. Also stores slot granularity, inter-appointment buffer, lunch break, messaging templates.

## API Endpoints

Next.js App Router route handlers under `/app/api/`. ~45 routes total. Admin routes require staff session + role check via middleware; cron routes authenticate with `CRON_SECRET` header, not user session.

### Public booking
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/services` | List active services |
| GET | `/api/services/[slug]` | Service detail |
| GET | `/api/slots?serviceId=&date=` | Available slots for service on date |
| POST | `/api/appointments` | Create PENDING appointment (public booking) |
| GET | `/api/appointments/[token]` | Self-service lookup by signed token |
| POST | `/api/appointments/[token]/cancel` | Self-service cancel |
| POST | `/api/appointments/[token]/reschedule` | Self-service reschedule into available slot |

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Staff login |
| POST | `/api/auth/logout` | Staff logout |
| GET | `/api/auth/me` | Current staff user |

### Admin — Appointments
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/appointments?date=` | Day view |
| GET | `/api/admin/appointments/[id]` | Detail |
| POST | `/api/admin/appointments` | Manual booking (CONFIRMED) |
| PATCH | `/api/admin/appointments/[id]` | Status change (confirm/cancel/complete/no-show) |
| POST | `/api/admin/appointments/[id]/reschedule` | Staff reschedule (re-checks availability) |

### Admin — Patients
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/patients?search=` | List with search |
| GET | `/api/admin/patients/[id]` | Detail (profile + history) |
| POST | `/api/admin/patients` | Create (returns duplicate warnings before save) |
| PATCH | `/api/admin/patients/[id]` | Edit |
| GET | `/api/admin/patients/[id]/history` | Union of COMPLETED appointments + Visits |
| POST | `/api/admin/patients/[id]/visits` | Add manual visit |

### Admin — Documents
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/patients/[id]/documents` | Upload (Vercel Blob) |
| GET | `/api/admin/patients/[id]/documents` | List |
| GET | `/api/admin/documents/[id]` | Download (staff-only, signed URL) |
| DELETE | `/api/admin/documents/[id]` | Delete |

### Admin — Messaging
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/sms/single` | Single SMS to patient |
| POST | `/api/admin/sms/broadcast` | Broadcast to day's appointments (delay template) |
| GET | `/api/admin/sms?batchId=&patientId=` | Message history |
| GET | `/api/admin/sms/batches` | Batch list |

### Admin — Waitlist
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/waitlist?serviceId=&active=` | List |
| POST | `/api/admin/waitlist` | Add entry |
| DELETE | `/api/admin/waitlist/[id]` | Remove / deactivate |

### Admin — KPIs & Exports
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/kpis?from=&to=` | KPI aggregates |
| GET | `/api/admin/exports/appointments?month=&format=csv\|xlsx` | Monthly export |

### Admin — Team (ADMIN only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/team` | List staff |
| POST | `/api/admin/team` | Create receptionist |
| PATCH | `/api/admin/team/[id]` | Edit / deactivate (bumps tokenVersion) |

### Admin — Content
| Method | Path | Purpose |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/admin/services` & `/[id]` | Services CRUD |
| GET/POST/PATCH/DELETE | `/api/admin/testimonials` & `/[id]` | Testimonials CRUD |
| GET/POST/PATCH/DELETE | `/api/admin/faqs` & `/[id]` | FAQ CRUD |
| GET/POST/PATCH/DELETE | `/api/admin/gallery` & `/[id]` | Gallery CRUD |

### Admin — Settings, Audit & Notifications
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/settings` | Get all settings |
| PATCH | `/api/admin/settings` | Update (working hours, slot config, templates) |
| GET | `/api/admin/audit?userId=&entityType=&from=` | Audit log query |
| GET | `/api/admin/notifications` | Staff notification feed |
| PATCH | `/api/admin/notifications/[id]/read` | Mark read |

### Cron (Vercel Cron → route handlers; `CRON_SECRET` auth)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cron/reminders` | 24h-before reminders to CONFIRMED appointments |
| GET | `/api/cron/no-show-followup` | Mark NO_SHOW + send follow-up SMS |

## Dependency Graph

```
Prisma schema (split across 3a/3b/3c — see Task List)
   3a: User, Patient, Service, Appointment        → engine + auth + bookings
   3b: Testimonial, FaqItem, GalleryItem, Setting  → public content + admin content mgmt
   3c: SmsMessage, AuditLog, Notification,
       WaitlistEntry, Visit, PatientDocument,
       SelfServiceToken                            → added lazily as features land
        │
        ├── Slot engine (pure logic: working hours, slot gen, overlap)
        │        │
        │        └── releaseSlot() shared domain function  ←───┐
        │                 │                                      │ slot-freed event
        │                 └── Atomic booking action              │
        │                         │                              │
        │                         └── Booking wizard UI +        │
        │                             POST /api/appointments     │
        │                                                        │
        ├── Auth/RBAC + audit helper  (deps: 3a only — NOT messaging) │
        │        │                                              │
        │        ├── Patient records + duplicate detection ──┐   │
        │        │                                            │   │
        │        └── Appointment management ─────────────────┤   │
        │             (manual booking needs patient CRUD)    │   │
        │                                                     │   │
        ├── MessageProvider interface ─► Mock / Twilio / WhatsApp
        │        │
        │        ├── Self-service link ─── calls releaseSlot() ──┤
        │        │
        │        └── Reminders + no-show cron (mock provider)
        │
        ├── Waitlist ─── subscribes to slot-freed event ─────────┘
        │             (fires on BOTH staff and self-service cancellations)
        │
        ├── i18n (next-intl, 3 locales, RTL) + localized() DB helper
        │        │
        │        ├── Public pages: services, FAQ, testimonials,
        │        │   gallery, about, contact, booking, Google Reviews
        │        └── Admin dashboard (FR only)
        │
        └── Admin server actions ─► appointments, patients (+duplicates),
                                    documents, SMS center, waitlist,
                                    KPIs, exports, team, content, settings,
                                    audit, notifications
```

Implementation order is bottom-up: schema (3a) → slot engine + atomic booking + releaseSlot (highest risk, first) → messaging → public booking UI → auth/RBAC → patient CRUD → appointment management → admin slices → notifications.

**Key dependency corrections from v1:**
- Auth/RBAC depends on schema (3a) only — **not** on messaging. It was wrongly ordered after Task 7 in v1.
- Patient CRUD comes **before** appointment management — manual booking needs patient lookup/create.
- `releaseSlot()` is a shared function introduced in Task 5, called by staff cancel (Task 14), self-service cancel (Task 8), and reschedule paths. Waitlist (Task 17) subscribes to its slot-freed event — so it fires on **all** cancellations, not just staff-driven ones.
- Reminders + no-show cron are built in Phase 3 with the mock provider (they only need messaging + appointments). Real Twilio/WhatsApp wiring is Phase 6.

## Task List

> Tasks tracked in `tasks/todo.md`. Renumbered from v1 — see "Key dependency corrections" above for the rationale. Acceptance criteria + verification per task live in `tasks/todo.md`.

### Phase 1: Foundation
- [ ] Task 1: Scaffold project (Next.js + TS + Tailwind + ESLint + Prisma + Postgres + Vitest + Vercel Blob + GitHub Actions CI)
- [ ] Task 2: i18n foundation + site shell + `localized()` DB helper (header, footer, hero, nav, locale switcher, RTL)

### Checkpoint: Foundation
- [ ] App builds clean, lint + typecheck pass, CI green
- [ ] 3 locales render with correct direction (RTL for Arabic)
- [ ] Postgres connected, `prisma migrate` works against dev + test DBs
- [ ] `localized()` helper unit-tested with FR fallback

### Phase 2: Scheduling Engine (high-risk, built first — no UI)
- [ ] Task 3a: Core schema (User, Patient, Service, Appointment) + migration + minimal seed (just enough to test the engine)
- [ ] Task 3b: Content schema (Testimonial, FaqItem, GalleryItem, Setting) + full seed from current site
- [ ] Task 4: Slot engine — pure functions: working hours lookup, slot generation per service, overlap detection, availability query (unit-tested)
- [ ] Task 5: Atomic booking action + `releaseSlot()` shared function — transactional book with in-transaction availability re-check + conflict error; `releaseSlot()` emits slot-freed event (concurrency-tested)

### Checkpoint: Engine correct
- [ ] Slot engine unit tests pass (overlap, boundaries, lunch, buffer)
- [ ] Concurrent bookings of the same slot: exactly one succeeds
- [ ] Booked slot renders as reserved in availability query
- [ ] `releaseSlot()` event fires on cancellation

### Phase 3: Public Booking + Communication
- [ ] Task 6: Booking wizard UI + `POST /api/appointments` + `GET /api/slots` — pick service → date → available/occupied slots → patient info → confirm → summary (integration-tested: happy + conflict paths)
- [ ] Task 7: Message abstraction + providers (Mock, Twilio-ready, WhatsApp) + `SmsMessage` + `Notification` models — confirmation on booking + staff dashboard notification
- [ ] Task 8: Self-service link — `SelfServiceToken` (revocable) in confirmation SMS; cancel + reschedule, both routing through `releaseSlot()` (Task 5)
- [ ] Task 9: Reminders + no-show follow-up cron (Vercel Cron, mock provider) — 24h-before reminders to CONFIRMED; cron marks NO_SHOW + sends follow-up SMS
- [ ] Task 10: Google Reviews embed widget on public site
- [ ] Task 11: Public content pages — services list/detail, FAQ, testimonials, gallery, about, contact (uses `localized()` helper, depends on Task 3b content schema)

### Checkpoint: Public booking works end-to-end
- [ ] Patient books an available slot; slot shows as reserved afterwards
- [ ] Confirmation SMS sent (mock provider); staff in-app notification fires
- [ ] Self-service cancel/reschedule works; `releaseSlot()` fires + slot reflects change
- [ ] Reminders + no-show cron run against seeded data (mock SMS logged)
- [ ] Google Reviews widget renders live rating across all 3 locales
- [ ] Public content pages render in all 3 locales with FR fallback

### Phase 4: Admin Core
- [ ] Task 12: Auth + RBAC + audit helper + dashboard shell — staff login, sessions (tokenVersion revocation), middleware, `/admin` shell, role-gated nav, `logAction()` helper, `AuditLog` model (deps: 3a — **not** Task 7)
- [ ] Task 13: Patient records + duplicate detection — CRUD, visit history timeline (COMPLETED appointments UNION Visits), notes, phone/name duplicate flagging (deps: Task 12)
- [ ] Task 14: Appointment management — day view, confirm-after-call, cancel, reschedule (re-checks availability), mark completed/no-show, manual booking creation (deps: Task 13 — manual booking needs patient CRUD)
- [ ] Task 15: Patient documents — Vercel Blob upload/download, patient-scoped, staff-only (deps: Task 13)

### Checkpoint: Admin scheduling loop
- [ ] Receptionist confirms/cancels/reschedules; each action audited + SMS fires
- [ ] Manual booking appears in slot availability; completed visit saved to history
- [ ] Duplicate patient flagged on creation; documents scoped + staff-only
- [ ] Deactivated staff session revoked immediately (tokenVersion bump)

### Phase 5: Admin Ops
- [ ] Task 16: SMS Center — manual single SMS + broadcast with delay template ("delayed by X min"); send history with batchId (deps: Task 14, Task 13)
- [ ] Task 17: Waitlist — entries per patient/service; subscribes to slot-freed event from `releaseSlot()` so it fires on **both** staff and self-service cancellations (deps: Task 14, Task 8)
- [ ] Task 18: KPIs overview — today's schedule, utilization rate, no-shows, new patients/month (unit-tested aggregations; deps: Task 14)
- [ ] Task 19: CSV/Excel export — monthly activity report (deps: Task 18)
- [ ] Task 20: Team management — admin creates/edits/deactivates receptionist accounts (deps: Task 12)
- [ ] Task 21: Content management + settings — services (incl. durations), gallery, testimonials, FAQ, working hours/slot config, messaging templates (deps: Task 12, Task 3b)

### Checkpoint: Admin ops complete
- [ ] Broadcast + waitlist + no-show flows verified
- [ ] Waitlist fires on self-service cancellation (not just staff)
- [ ] KPIs and exports produce correct numbers (unit-tested)
- [ ] Role restrictions enforced (receptionist cannot manage team/settings)

### Phase 6: Production Readiness
- [ ] Task 22: Twilio + WhatsApp provider wiring — flip `MESSAGE_PROVIDER` from mock to real; verify against a real DZ number (deps: Task 16)
- [ ] Task 23: SEO/OG, sitemap, robots.txt, performance pass, Sentry, deploy to Vercel, env config, handoff docs (deps: Task 21, Task 22)

### Checkpoint: Complete
- [ ] All acceptance criteria met (see tasks/todo.md)
- [ ] Deployed to Vercel; real SMS/WhatsApp verified against DZ number
- [ ] Sentry capturing errors; handoff documentation ready for clinic owner

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Double-booking on concurrent requests | High | Atomic transaction with in-transaction availability re-check; concurrency unit test; optional Postgres range EXCLUDE constraint in production |
| Twilio SMS to DZ numbers cost/availability | High | Provider abstraction; mock in dev; verify Algeria rates before go-live; WhatsApp as alternative channel |
| Arabic RTL layout breaks sections | Med | RTL tested from Task 2; i18n first, not retrofitted |
| Weak staff auth on health data | Med | Strong passwords, HTTPS-only, RBAC, audit trail of staff actions, tokenVersion session revocation |
| Signed self-service token abuse | Med | `SelfServiceToken` table (revocable, replay-protected); short expiry; action limited to cancel/reschedule-into-available-slots; rate-limited |
| Wrong default durations for services | Med | Seed durations are estimates; admin edits service durations; slot engine driven by DB values |
| Slot engine edge cases (lunch, buffer, boundaries) | Med | Pure-logic unit tests before any UI |
| Document upload security | Med | Vercel Blob signed uploads, type/size limits, patient-scoped access, staff-only routes |
| Duplicate patient creation pollutes records | Low | Flag + acknowledgment gate at create/edit (Task 13) |
| Waitlist misses self-service cancellations | Med | Shared `releaseSlot()` emits slot-freed event; waitlist subscribes — fires on staff AND self-service paths |
| Hard-delete breaks historical references (Patient, Service) | Med | Soft-delete only (`active=false`); never destroy rows referenced by appointments |
| Algeria data-protection law (18-07) — patient-adjacent data | Med | Staff-only access, audit trail, min data collection, no patient self-service data exposure beyond own appointment; confirm with clinic if formal registration needed |
| Unmonitored prod errors on patient-adjacent system | Med | Sentry wired in Task 23; alerting on auth/messaging failures |
| Scope creep (many features) | Med | Vertical slices with working checkpoints; features 4 & 6 dropped; remaining locked per confirmed set |

## Open Questions
- Exact durations per service (est. to be confirmed with the clinic); defaults editable in dashboard
- Real messaging provider at go-live (Twilio vs local DZ SMS provider vs WhatsApp Business API) — Task 22 decides; interface keeps it swappable
- Does the clinic want a lunch break in the schedule? (Assumed configurable, default off)
- Broadcast + no-show SMS permissions: admin-only, or also receptionist? (Assumed admin-only for broadcasts; receptionist can send single SMS)
- ~~Admin dashboard language: FR only, or also AR/EN?~~ **Resolved: FR-only dashboard, trilingual public site.**