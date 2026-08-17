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
- **Deployment:** Vercel + managed Postgres + Vercel Blob + Vercel Cron (reminders, no-show follow-up). Seed data migrated from the current site (services, testimonials, FAQ).

## Domain / Data Model

- `User` — id, name, email, passwordHash, role (`ADMIN`|`RECEPTIONIST`), active
- `Patient` — id, firstName, lastName, phone, email, birthDate, notes, timestamps
- `Service` — id, slug, name (per-locale), description (per-locale), durationMinutes, price (optional), active
- `Appointment` — id, patientId, serviceId, startTime, endTime (= start + service.duration), status, source (`ONLINE`|`MANUAL`), createdByUserId, confirmedAt, confirmedByUserId, visitNotes, timestamps
- `Visit` — manual history records: id, patientId, date, serviceId?, type, notes, treatment
- `PatientDocument` — id, patientId, name, type, url, uploadedById, uploadedAt
- `WaitlistEntry` — id, patientId, serviceId, preferredDates, active, createdAt
- `SmsMessage` — id, to, body, type (`CONFIRMATION`|`REMINDER`|`NO_SHOW`|`MANUAL`|`BROADCAST`|`RESCHEDULE`|`DELAY`|`WAITLIST`), batchId, provider, status, appointmentId?, sentById, sentAt
- `AuditLog` — id, userId, action, entityType, entityId, detail (json), createdAt
- `Testimonial`, `FaqItem`, `GalleryItem` — public content, per-locale fields, `active`
- `Setting` — key/value (working hours, slot granularity, buffer, messaging templates, lunch break)

## Dependency Graph

```
Prisma schema (User, Patient, Service, Appointment, Visit, PatientDocument,
              WaitlistEntry, SmsMessage, AuditLog, content, Setting)
        │
        ├── Slot engine (pure logic: working hours, slot gen, overlap)
        │        │
        │        └── Atomic booking action (transaction + conflict check)
        │                 │
        │                 └── Booking wizard UI (service → date → slot → confirm)
        │
        ├── MessageProvider interface ─► Mock / Twilio / WhatsApp
        │        │
        │        └── Self-service link (signed token) + notifications
        │
        ├── Auth/RBAC + audit (sessions, middleware, /admin)
        │        │
        ├── Admin server actions ─► appointments, patients (+duplicates),
        │        │                    documents, SMS center, waitlist,
        │        │                    KPIs, exports, team, content, settings
        └── i18n (next-intl, 3 locales, RTL)
                 └── Public pages (services, FAQ, testimonials, gallery, booking,
                                   Google Reviews embed)
```

Implementation order is bottom-up: schema → slot engine + atomic booking (highest risk, first) → messaging → auth/RBAC → public booking UI → admin slices → notifications.

## Task List

### Phase 1: Foundation
- [ ] Task 1: Scaffold project (Next.js + TS + Tailwind + ESLint + Prisma + Postgres, CI build)
- [ ] Task 2: i18n foundation + site shell (header, footer, hero, nav, locale switcher, RTL)

### Checkpoint: Foundation
- [ ] App builds clean, lint + typecheck pass
- [ ] 3 locales render with correct direction (RTL for Arabic)
- [ ] Postgres connected, `prisma migrate` works

### Phase 2: Scheduling Engine (high-risk, built first)
- [ ] Task 3: Core schema + seed — all models incl. WaitlistEntry + AuditLog + Setting; seed services/testimonials/FAQ from current site
- [ ] Task 4: Slot engine — pure functions: working hours lookup, slot generation per service, overlap detection, availability query (unit-tested)
- [ ] Task 5: Atomic booking action — transactional book with in-transaction availability re-check + conflict error + retry; exposed as a testable server function

### Checkpoint: Engine correct
- [ ] Slot engine unit tests pass (overlap, boundaries, lunch, buffer)
- [ ] Concurrent bookings of the same slot: exactly one succeeds
- [ ] Booked slot renders as reserved in availability query

### Phase 3: Public Booking + Communication
- [ ] Task 6: Booking wizard UI — pick service → pick date → see available/occupied slots → patient info → confirm → summary
- [ ] Task 7: Message abstraction + providers (Mock, Twilio-ready, WhatsApp) + SmsMessage audit — confirmation on booking, staff dashboard notification
- [ ] Task 8: Self-service link — signed token in confirmation SMS; cancel + reschedule into available slots
- [ ] Task 9: Google Reviews embed widget on public site

### Checkpoint: Public booking works end-to-end
- [ ] Patient books an available slot; slot shows as reserved afterwards
- [ ] Confirmation SMS sent (provider-agnostic); staff notified
- [ ] Self-service cancel/reschedule works; occupied slot freed/updated
- [ ] Google Reviews widget renders live rating

### Phase 4: Admin Core
- [ ] Task 10: Auth + RBAC + audit — staff login, sessions, middleware, `/admin` shell, role-gated nav, action audit logging
- [ ] Task 11: Appointment management — day view, confirm-after-call, cancel, reschedule (re-checks availability), mark completed/no-show, manual booking creation
- [ ] Task 12: Patient records — CRUD, visit history timeline, notes, duplicate detection (phone/name flags on create/edit)
- [ ] Task 13: Patient documents — Vercel Blob upload/download, patient-scoped, staff-only

### Checkpoint: Admin scheduling loop
- [ ] Receptionist confirms/cancels/reschedules; each action audited + SMS fires
- [ ] Manual booking appears in slot availability; completed visit saved to history
- [ ] Duplicate patient flagged on creation; documents scoped + staff-only

### Phase 5: Admin Ops
- [ ] Task 14: SMS Center — manual single SMS + broadcast with delay template ("delayed by X min"); send history with batchId
- [ ] Task 15: Waitlist — entries per patient/service; notify when a slot frees (cancellation)
- [ ] Task 16: KPIs overview — today's schedule, utilization rate, no-shows, new patients/month
- [ ] Task 17: CSV/Excel export — monthly activity report
- [ ] Task 18: Team management — admin creates/edits/deactivates receptionist accounts
- [ ] Task 19: Content management + settings — services (incl. durations), gallery, testimonials, FAQ, working hours/slot config, messaging templates

### Checkpoint: Admin ops complete
- [ ] Broadcast + waitlist + no-show flows verified
- [ ] KPIs and exports produce correct numbers
- [ ] Role restrictions enforced (receptionist cannot manage team/settings)

### Phase 6: Production Readiness
- [ ] Task 20: Twilio + WhatsApp providers, reminder cron + no-show follow-up cron (Vercel Cron)
- [ ] Task 21: SEO/OG, sitemap, robots.txt, performance pass, deploy to Vercel, env config, handoff docs

### Checkpoint: Complete
- [ ] All acceptance criteria met (see tasks/todo.md)
- [ ] Deployed to Vercel; real SMS/WhatsApp verified
- [ ] Handoff documentation ready for clinic owner

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Double-booking on concurrent requests | High | Atomic transaction with in-transaction availability re-check; concurrency unit test; optional Postgres range EXCLUDE constraint in production |
| Twilio SMS to DZ numbers cost/availability | High | Provider abstraction; mock in dev; verify Algeria rates before go-live; WhatsApp as alternative channel |
| Arabic RTL layout breaks sections | Med | RTL tested from Task 2; i18n first, not retrofitted |
| Weak staff auth on health data | Med | Strong passwords, HTTPS-only, RBAC, audit trail of staff actions |
| Signed self-service token abuse | Med | Server-secret signed, short expiry, action limited to cancel/reschedule-into-available-slots, rate-limited |
| Wrong default durations for services | Med | Seed durations are estimates; admin edits service durations; slot engine driven by DB values |
| Slot engine edge cases (lunch, buffer, boundaries) | Med | Pure-logic unit tests before any UI |
| Document upload security | Med | Vercel Blob signed uploads, type/size limits, patient-scoped access, staff-only routes |
| Duplicate patient creation pollutes records | Low | Flag + acknowledgment gate at create/edit (Task 12) |
| Scope creep (many features) | Med | Vertical slices with working checkpoints; features 4 & 6 dropped; remaining locked per confirmed set |

## Open Questions
- Exact durations per service (est. to be confirmed with the clinic); defaults editable in dashboard
- Real messaging provider at go-live (Twilio vs local DZ SMS provider vs WhatsApp Business API) — Task 20 decides; interface keeps it swappable
- Does the clinic want a lunch break in the schedule? (Assumed configurable, default off)
- Broadcast + no-show SMS permissions: admin-only, or also receptionist? (Assumed admin-only for broadcasts; receptionist can send single SMS)
- Admin dashboard language: FR only, or also AR/EN? (Assumed FR default)