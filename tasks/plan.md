# Implementation Plan: Ortho'Care Clinic — New Website

## Overview

A from-scratch replacement for clinicorthocare.com: a trilingual (FR / AR / EN, Arabic RTL) public site for an orthodontics clinic in Algiers, with a **real slot-based online reservation system** and a **role-based admin dashboard**.

Patients book online: they pick a consultation type (cleaning, checkup, orthodontics, etc. — each with an estimated duration), see the day's **available time slots** (already-booked slots render as reserved), and pick one to reserve. A **phone call by the receptionist is required to confirm** an online booking. Confirmation SMS includes a **self-service link** to cancel or reschedule into an available slot.

When finishing a booking, the patient may opt in to **cancellation alerts**: they pick one or more days to watch (typically the day they originally wanted but found fully booked), and if a slot frees on a watched day because someone cancelled, they receive an SMS. This is the patient-facing half of the waitlist; staff can add waitlist entries too.

The dashboard has two roles — **admin** and **receptionist** (created by admin). Staff manage reservations (confirm/cancel/reschedule after phone calls), add manual bookings, manage patient records (profile, visit history, uploaded documents), and send SMS: single messages or **broadcasts** (e.g., "today's appointments delayed by 30 min"). Every completed patient visit is saved as history. Patients do **not** log in — their record is admin-managed only.

The scheduling engine (slot generation, overlap detection, atomic conflict-free booking) is the heavy part of the backend and is built and tested first.

## Goals, Non-Goals & Success Metrics

**Goals**
1. Let patients book a real appointment online, in their own language, without phoning the clinic.
2. Cut the receptionist's phone workload for routine scheduling (booking, cancelling, rescheduling, reminding).
3. Reduce no-shows through automatic reminders and easy self-service rescheduling.
4. Give the clinic one reliable place for patient records, visit history and documents.
5. Make the clinic easy to find online in French, Arabic and English.

**Non-Goals** (explicitly out of scope for v1 — this list exists to prevent scope creep)
- **No patient login or patient portal** — patients act only through their own appointment link. Keeps both the build and the attack surface small.
- **No online payment** — payment happens at the clinic. Avoids card-security (PCI) obligations entirely.
- **No insurance or reimbursement handling** — too complex for a first release.
- **No multi-clinic / multi-branch support** — one clinic, one schedule.
- **No per-practitioner or per-chair scheduling in v1** — see the single-resource assumption in Architecture Decisions; the code leaves a seam for it.
- **No patient intake forms, no recall campaigns** — features 4 and 6, dropped and confirmed.

**Success Metrics** — measured 3 months after launch

| Metric | How it is measured | Target |
|---|---|---|
| Share of appointments booked online | `Appointment.source = ONLINE` ÷ all appointments | ≥ 30% |
| Time from online booking to confirmation call | median of `confirmedAt − createdAt` | < 4 working hours |
| No-show rate | `NO_SHOW` ÷ (`COMPLETED` + `NO_SHOW`) | ≥ 30% below today's baseline |
| Slot utilization | booked minutes ÷ open minutes, per week | ≥ 70% |
| Self-service usage | cancels/reschedules via link ÷ all cancellations | ≥ 40% |
| Abandoned online bookings | auto-expired PENDING ÷ all online bookings | < 10% |

> **Baseline first:** write down today's no-show rate and weekly appointment volume **before** launch. Without a "before" number, the "after" number proves nothing.

## Confirmed Feature Set

| # | Feature | Status |
|---|---------|--------|
| — | Slot-based booking with per-service durations | Core |
| — | RBAC admin dashboard (admin + receptionist) | Core |
| — | SMS center: single + broadcast with delay template | Core |
| 1 | **WhatsApp** as full provider behind the same abstraction as SMS | In |
| 2 | **Google Reviews** embed widget on public site (+ show only 4★+ reviews if the clinic opts for the Places API route) | In |
| 3 | **Self-service link** in confirmation SMS: cancel + reschedule | In |
| 5 | **KPIs** dashboard (schedule, utilization, no-shows, new patients) | In |
| 7 | **Waitlist / cancellation alerts** — patients pick watched days at the end of booking; staff can add entries too; both notified when a slot frees | In |
| 8 | **No-show follow-up** SMS (automatic, cron) | In |
| 9 | **CSV/Excel export** of monthly activity | In |
| 10 | **Duplicate patient detection** (same phone/name) | In |
| 11 | **Google Maps location** — embedded map + one-click "Open in Google Maps" directions | In |
| 4 | Patient intake form | Dropped |
| 6 | Recall campaigns | Dropped |

## Architecture Decisions

- **Stack:** Next.js (App Router) + TypeScript + Tailwind CSS. One codebase for public site, API, and dashboard. No separate backend.
- **Database:** Postgres via Prisma ORM (Vercel Postgres or Neon).
- **i18n:** `next-intl`. Locales `fr`, `ar`, `en` with Arabic RTL + locale switcher. DB-driven content uses per-locale fields.
- **Messaging:** `MessageProvider` interface. Implementations: `MockProvider` (logs to DB, dev), `TwilioProvider` (SMS, prod), `WhatsAppProvider` (prod, same templates). Selected via env. Every message recorded in `SmsMessage` with a `batchId` for broadcasts. Templates stored in Settings.
  - **Channel strategy (decided): WhatsApp-first + SMS fallback.** Twilio SMS to Algeria is ~$0.27/segment and needs an alphanumeric sender ID (numeric sender IDs fail on Mobilis); WhatsApp Business API is ~$0.01–0.02/message to DZ (per-message billing since Jul 2025; service messages become chargeable Oct 1 2026). With ~90% of Algerian numbers on WhatsApp, a hybrid costs ~6–7× less than all-SMS (~$30–40/mo vs ~$200+/mo at ~600–800 msgs). Production path (Task 22): try WhatsApp via Meta Cloud API directly (no BSP markup); check registration via `POST /{phone-number-id}/contacts` or catch the "not on WhatsApp" send error; fall back to SMS via Twilio. `SmsMessage.provider` records the channel actually used so WhatsApp coverage and per-message cost are measurable. `MESSAGE_PROVIDER` remains the escape hatch.
  - **Dispatcher owns the row lifecycle.** The `sendMessage()` gate (`lib/messaging/index.ts`) enforces opt-out, renders templates, creates the `SmsMessage` row, calls the provider, and persists the outcome. Providers are pure adapters with no policy, so the transactional/non-transactional split lives in one place and no feature bypasses it. (The plan's earlier "MockProvider logs to DB" wording is realised as: the mock provider does nothing and the dispatcher's row IS the log.)
  - **Patient language & WhatsApp opt-in (Task 7):** the booking form captures `locale` and a WhatsApp opt-in checkbox; both are stored on `Patient` (`preferredLocale`, `whatsappOptIn`) so later tasks message in the right language and never message an opted-out contact on WhatsApp.
  - **Transactional vs non-transactional.** Transactional messages (booking received, confirmation, reschedule, cancellation) are always sent — they are the service the patient asked for. Non-transactional messages (waitlist offers, no-show follow-up, delay broadcasts) are **suppressed for patients with `messagingOptOut = true`**. The dispatcher enforces this in one place so no feature can bypass it.
  - **Opt-out:** every non-transactional message carries a short opt-out instruction; staff can also flip the flag from the patient record.
  - **WhatsApp go-live prerequisites:** Meta requires documented patient opt-in **and** pre-approved message templates for business-initiated messages. Approval takes review time — it is a scheduling dependency for Task 22, not a coding detail. Start template submission early.
  - **Send idempotency:** automated sends are keyed so a retried or overlapping job cannot message the same patient twice (see `reminderSentAt` and the unique index on `SmsMessage`).
- **Auth/RBAC:** staff users with roles `ADMIN` and `RECEPTIONIST`. Email/password, signed session cookie, middleware-protected `/admin` routes. Patients have **no login**. Every staff action (confirm, cancel, reschedule, SMS, patient edit) written to an **audit trail**.
  - **Session cookie:** `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix, signed. Absolute expiry 12h, idle expiry 2h. `tokenVersion` mismatch invalidates instantly.
  - **CSRF:** state-changing requests (POST/PATCH/DELETE) verify the `Origin`/`Referer` header against the site origin. `SameSite=Lax` alone is not treated as sufficient.
  - **Passwords:** argon2id, minimum 12 characters, blocked against a common-password list. Failed logins are throttled and an account locks temporarily after repeated failures (see Abuse controls).
  - **Password recovery:** **no public "forgot password" email flow** — an ADMIN issues a one-time reset from Team management, and the staff member must set a new password at next login (`mustChangePassword`). Fewer moving parts, smaller attack surface, and it matches how a small clinic actually works.
  - **Least privilege for destructive/bulk actions:** deleting documents, generating exports, reading the audit log and managing settings/team are **ADMIN-only**. Receptionists keep everything needed for daily scheduling.
- **Reservation model (slot-based):**
  - Each `Service` has `durationMinutes` (estimation time per consultation type).
  - `generateSlots(date, service)` → candidate start times inside working hours (configurable granularity, buffer, lunch break), minus overlap with existing active appointments.
  - Booking is **atomic**: availability re-checked inside a DB transaction before insert; conflicts return an error. Production-hardening option: Postgres range EXCLUDE constraint via raw SQL.
  - Status lifecycle: `PENDING` (online, awaiting phone call) → `CONFIRMED` (after call) → `COMPLETED` / `NO_SHOW` / `CANCELLED` / `RESCHEDULED`. Manual (phone) bookings can be created directly as `CONFIRMED`.
  - **PENDING bookings expire automatically.** An unconfirmed online booking blocks its slot, so a cron auto-cancels it after `pendingExpiryHours` (default 24h) — and always before the appointment starts. Expiry runs through `releaseSlot()`, so the slot returns to availability and the waitlist is notified like any other cancellation.
  - **Booking window rules** (all editable settings): minimum lead time before a slot can be booked (default 2h), maximum booking horizon (default 90 days), and past dates always rejected. Prevents "booked the 17:00 slot at 16:58" and calendars filled three years out.
  - **Single-resource assumption (v1):** the clinic treats **one patient at a time** — any overlapping active appointment blocks a slot. This is stated deliberately because it is the most expensive assumption to discover late: with two chairs or two practitioners, every availability query changes. The slot engine therefore takes an optional `resourceId` parameter that defaults to a single implicit resource, so adding chairs later is a change of inputs rather than a rewrite. **Confirm the real number of chairs with the clinic before Task 4.**
- **Self-service link:** revocable token (`SelfServiceToken` row) embedded in the confirmation SMS. Grants exactly two actions: cancel the appointment, or reschedule into an available slot. Expires; single-use for cancel.
  - **Minimum disclosure — the token page shows only:** service name, date and time, clinic address/phone, and the patient's **first name**. It must never expose phone, email, birth date, clinical notes, visit history, documents, or any other appointment.
  - **No referrer leakage:** the token sits in the URL, so the token page sends `Referrer-Policy: no-referrer` and loads **no third-party scripts** (no Google Reviews widget, no analytics). Without this, an embedded script receives the token in the `Referer` header.
  - **Rotation and rate limits:** rescheduling issues a fresh token and revokes the old one; token lookups are rate-limited to prevent guessing; every self-service action is audited with actor `PATIENT`.
- **Google Reviews:** official embed widget on the public site (no API key, live rating/reviews). It is a third-party script, so: it is allow-listed explicitly in the Content-Security-Policy, disclosed in the privacy notice as a data flow to Google, and **excluded from the self-service token pages**.
  - **4★-and-up filter (clinic request):** the no-API-key embed widget shows *all* reviews and cannot filter by star rating. Showing only 4★+ reviews requires either the **Google Places API** (server-side fetch + filter; needs an API key and is usage-billed) or a third-party review widget. **Decision needed:** (a) keep the free embed showing all reviews, or (b) use the Places API to show only 4★+ reviews (adds an API key, cost, and server-side caching). Until decided, Task 10 defaults to the free embed; the 4★ filter is tracked as an Open Question.
- **Google Maps / location:** the clinic location is shown on the contact page (and optionally home/footer) as an embedded Google Maps iframe with the clinic's address, plus a **one-click "Open in Google Maps" directions button** (a plain `google.com/maps/dir/?api=1&destination=<lat>,<lng>` link — no API key, works on mobile and desktop). The map is a Google iframe, so like the reviews widget it is allow-listed in the CSP and disclosed in the privacy notice as a data flow to Google. It is **not** loaded on self-service token pages.
- **Waitlist (cancellation alerts):** `WaitlistEntry` per patient/service with `preferredDates` and a **`source` (`PATIENT`|`STAFF`)**. Two doors into it: (1) at the end of the public booking wizard the patient may opt in and pick one or more days to watch — aimed at those who wanted a specific day but found it fully booked; days the patient browsed with zero availability are pre-suggested. The entry is created in the same transaction as the booking, covered by the route's existing rate limits, and `watchDates` is validated by the same Zod schema (within booking horizon, no past dates). (2) Staff add entries from the dashboard (Task 17). When a slot frees (any `releaseSlot()` path — staff cancel, self-service cancel, auto-expiry, reschedule), the subscriber notifies active entries whose `serviceId` matches and whose `preferredDates` contain the freed slot's clinic-local date. Notification is via SMS (non-transactional → opt-out rules apply), sets `notifiedAt` and deactivates the entry — **one notification per entry in v1** (if the patient misses it they can re-watch); lifting this to one notification per watched date is a small follow-up if the clinic wants it. Dates are stored as clinic-local dates at UTC midnight (stable: Africa/Algiers has no DST) and all date maths goes through `lib/time/clinicTime.ts`. The `slot-freed` event carries `serviceId` for the match.
- **KPIs & exports:** computed on demand from appointments (no extra tables). CSV and XLSX generation in `lib/export`. An export is a **bulk extract of patient data**, therefore: ADMIN-only, audited as `EXPORT_GENERATED` with the row count and date range, and clinical notes excluded unless explicitly requested.
- **Duplicate detection:** on patient creation/edit, flag existing patients sharing phone or name; requires staff acknowledgment to proceed.
- **Working hours / Settings:** store open hours per weekday (Sat–Thu, 10h–17h; Fri closed), slot granularity, inter-appointment buffer — editable in dashboard.
- **Closure dates (`ScheduleException`):** weekly hours cannot express Eid, national holidays, vacation, or "closed Thursday afternoon". A closure is a date or date range, full-day or partial, with a reason, and the slot engine subtracts it from availability. Without this, patients book online on days the clinic is shut — worse for trust than having no online booking at all.
  - **Existing appointments are never silently orphaned:** adding a closure that covers booked appointments shows the affected list and offers bulk cancel-and-notify or reschedule. Staff decide; the system never drops them quietly.
- **Timezone:** the clinic operates in **Africa/Algiers (UTC+1, no daylight saving)**. All timestamps are stored in **UTC**; working hours, slot generation, day boundaries and KPI date ranges are computed **in clinic-local time**; the UI renders local time. Cron schedules are defined in UTC with the intended local hour written next to them. This is stated explicitly because Vercel runs UTC and Postgres stores UTC while the clinic thinks in local time — the classic silent one-hour drift in both slots and reminders.
- **Abuse controls (public endpoints):** the two unauthenticated write paths are rate-limited — `POST /api/appointments` (per IP and per phone), `/api/auth/login` (per IP and per account, with temporary lockout after repeated failures), plus lighter limits on `GET /api/slots` and self-service token lookups. A cap on simultaneously active PENDING bookings per phone prevents one script from filling the calendar. Counters live in a small Postgres table (no new vendor); an optional bot check (Turnstile/hCaptcha) can be enabled on the booking form. Lockouts are audited. **Client IP comes exclusively from the `getClientIp()` helper** (`lib/security/clientIp.ts`) — it reads the trusted proxy headers (`x-real-ip` / `x-vercel-forwarded-for`) and never trusts a raw client-supplied `x-forwarded-for` by default, so a forged header cannot mint a fresh rate-limit identity and bypass the limiter.
- **Security headers:** Content-Security-Policy (allow-listing the Google Reviews embed), HSTS, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options: nosniff` — set centrally in `next.config.ts`/middleware, with a stricter `Referrer-Policy: no-referrer` on token pages. **Implemented in `lib/security/headers.ts`** and applied via `next.config.ts` (`SECURITY_HEADERS` globally, `NO_REFERRER_HEADERS` on the self-service token path). ⚠ **Task 10 must extend the CSP** with the Google embed domains before mounting Reviews/Maps, and the `no-referrer` token-page rule is a hard dependency of Task 8 — the token in the URL must never reach a third-party script in the `Referer` header.
- **Consent & privacy notice:** the booking form captures explicit consent (checkbox) and stores `consentAt` + `consentVersion` on the patient. A privacy notice page in all three locales explains what is collected, why, who processes it (hosting, database, messaging, error monitoring), and how to ask for correction or deletion.
- **Data retention & erasure:** retention windows are documented for message bodies, audit logs, documents and error-monitoring events. Because rows are never hard-deleted, an erasure request is satisfied by **anonymization**: identifying fields are scrubbed and `anonymizedAt` is set, while the appointment shell remains so historical statistics stay correct. Erasure is ADMIN-only and audited.
- **Phone numbers are normalized to E.164** (`+213…`) on every write, stored alongside the display form, and indexed. Both duplicate detection and message delivery key off phone, and `0550123456` / `+213 550 12 34 56` / `00213550123456` are the same person — but not to a database index. Without normalization, duplicate detection fails *silently* and messages bounce.
- **Patients:** admin-managed accounts — profile (name, phone, email, birth date, notes), visit history (from appointments + manual visit records), uploaded documents, consent record and messaging opt-out flag. Patients never log in.
- **Documents:** patient documents (X-rays, photos, files) in Vercel Blob; metadata in DB, patient-scoped, staff-only access.
  - **Stored privately, never as a public URL.** Confirm the Blob access mode available on the plan; if only public-URL blobs exist, downloads must go through the authenticated route `GET /api/admin/documents/[id]`, which checks the staff session per request and then streams the file or issues a short-lived signed URL. A public blob URL is unguessable but **permanent and login-free** — once it leaks into a chat, a browser history or an error report, an X-ray is exposed forever with no way to revoke it.
  - **Upload hardening:** MIME allow-list (JPEG, PNG, PDF, DICOM), size cap, extension/content-type agreement check, `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on download. An uploaded SVG or HTML file served inline from your own domain is stored cross-site scripting.
  - Downloads and deletions are audited (`PATIENT_DOCUMENT_DOWNLOADED`, `PATIENT_DOCUMENT_DELETED`); deletion is ADMIN-only.
- **Admin dashboard language: FR only.** Public site is trilingual (FR/AR/EN). Dashboard UI, labels, and validation messages are FR-only. Rationale: staff are local; trilingual admin UI doubles the dashboard effort for no audience. Decided — no longer an open question.
- **i18n of DB-driven content:** per-locale fields stored as **JSON columns** (`name: {fr, ar, en}`, `description: {fr, ar, en}`). Helper `localized(field, locale, fallback='fr')` centralizes retrieval with FR fallback. Owned by Task 2 (helper) + Task 3b (schema). Avoids a translation table for 3 locales + short strings; Postgres JSON ops support queries if needed.
- **Testing strategy:** Vitest + a dedicated test Postgres database.
  - **Unit tests (required):** slot engine (Task 4), atomic booking concurrency (Task 5), audit helper, auth/RBAC gating (Task 12), booking wizard happy + conflict paths (Task 6), KPI aggregations (Task 18), duplicate detection (Task 13).
  - **Integration tests (required):** booking lifecycle (PENDING→CONFIRMED→COMPLETED), self-service cancel/reschedule, waitlist notification on cancellation, PENDING auto-expiry, cron idempotency (running twice sends exactly one message).
  - **Authorization matrix test (required, standing):** one table-driven test walking **every** `/api/admin/*` route × {anonymous, receptionist, admin, deactivated user} and asserting the expected status code. In an RBAC system this is simultaneously the most likely bug and the most damaging one, and it is usually introduced by a later unrelated task — so the table is updated whenever a route is added. Plus negative tests for self-service tokens: expired, already used, revoked, and belonging to a different appointment.
  - **Manual verification:** visual UI, i18n/RTL rendering, real SMS in staging.
  - **Test data is synthetic only.** No copy of production patient data is ever used in dev, test or staging.
  - Every backend slice is tested with a route-level integration test against the test DB, not just curl.
- **Audit logging:** a shared `logAction(actor, action, entityType, entityId, detail)` helper is delivered in Task 12 (auth) and called by Tasks 13–21. `action` is an enum, `detail` is JSON for context. Later tasks call the helper; they do not re-implement audit.
  - **Actor model:** `actor` is `{type: 'STAFF'|'SYSTEM'|'PATIENT', userId?}`. Cron jobs (auto-expiry, no-show marking) act as `SYSTEM`; self-service cancel/reschedule acts as `PATIENT`. The original `logAction(userId, …)` signature could not express either, so Tasks 8, 9 and 17 would have had no valid value to pass.
  - **Reads are audited too, not just writes.** For patient data, *who looked at and extracted what* matters as much as who changed it: viewing a patient record, downloading a document and generating an export are all logged.
  - **Append-only:** the application never updates or deletes `AuditLog` rows. Reading the audit log is ADMIN-only, and reading it is itself audited (`AUDIT_VIEWED`).
- **Shared slot-release function:** a `releaseSlot(appointmentId, reason)` domain function is introduced in Task 5 and called by every path that frees a slot (staff cancel in Task 14, self-service cancel in Task 8, reschedule). It emits a **slot-freed event** that Task 17 (waitlist) subscribes to. This makes waitlist notifications fire on *all* cancellations, not just staff-driven ones.
- **Validation:** Zod schemas in `src/schemas/` — one module per endpoint group; shared between route handlers (server) and forms (client). Added in Task 1.
- **CI:** GitHub Actions — build, lint, typecheck, test on every PR; `prisma migrate` + seed against a ephemeral test DB.
- **Error monitoring:** Sentry in production (added to Task 23) — patient-adjacent data warrants observability. Configured with `sendDefaultPii: false` and a `beforeSend` hook that strips request bodies, masks self-service tokens in URLs, and removes patient names from error messages. By default an error monitor is an excellent tool for shipping patient names and live tokens to a third party; a data-processing agreement with the vendor is noted in the privacy notice.
- **Uptime & delivery monitoring:** an external uptime check on the public site and on `/api/health`, plus an alert if a cron job stops reporting or if message-send failures spike. Sentry catches errors, not silence — a reminder cron that quietly stops running produces no errors at all.
- **Backups & business continuity:** managed Postgres point-in-time recovery enabled, Blob contents backed up, and **a restore actually tested once before go-live** — an untested backup is not a backup. Because this becomes the clinic's entire appointment book on day one, staff can print or export the day's schedule, giving them a paper fallback if the site is unreachable during clinic hours.
- **Environments:** three — local dev, **staging** (own database, own Blob store, mock or sandbox messaging, synthetic data only), and production. Staging is provisioned in Task 1; Task 22's real-provider verification depends on it existing.
- **SEO & local discoverability:** for a local clinic replacing a live domain this is a launch requirement, not a finishing touch — `hreflang` tags across the three locales (without them Google may treat FR/AR/EN pages as duplicates), **301 redirects from every existing clinicorthocare.com URL** (replacing a live site without them discards its accumulated ranking), `Dentist`/`MedicalBusiness` JSON-LD structured data with address, geo coordinates and opening hours, canonical URLs, per-locale sitemaps, and name/address/phone consistency with the Google Business Profile the reviews widget already points at.
- **Vercel Blob:** configured in Task 1 (env + dependency), consumed in Task 15 (patient documents).
- **Deployment:** Vercel + managed Postgres + Vercel Blob + Vercel Cron (reminders, no-show follow-up, PENDING expiry). Seed data migrated from the current site (services, testimonials, FAQ).
- **Launch cutover:** DNS switch with the old site kept reachable until the new one is verified, 301 redirects in place from day one, per-locale sitemaps resubmitted, and a written rollback step (revert DNS) if something breaks on launch day.
- **Cross-border data processing:** hosting, database, messaging and error monitoring all sit outside Algeria, so patient-adjacent data leaves the country. Algeria's Law 18-07 treats this as a restricted transfer. The processors used are listed in the privacy notice, and whether a formal declaration or authorization is required is an open question to settle with the clinic before go-live — it is a paperwork question with a lead time, not a technical blocker.

## Domain / Data Model

Per-locale fields are JSON columns (`{fr, ar, en}`); see `localized()` helper in Architecture Decisions.

- `User` — id, name, email, passwordHash, role (`ADMIN`|`RECEPTIONIST`), active, **tokenVersion** (int; bumped on deactivate **or password reset** to revoke live sessions), **mustChangePassword** (bool — set by an admin-issued reset), **lastLoginAt**, **failedLoginCount**, **lockedUntil** (nullable — temporary lockout after repeated failures), timestamps
- `Patient` — id, firstName, lastName, phone (as typed, for display), **phoneE164** (normalized `+213…`, indexed, non-unique — this is the field duplicate detection and messaging use), email, birthDate, notes, **consentAt** / **consentVersion** (nullable — consent captured at online booking), **messagingOptOut** (bool, default false), **preferredLocale** (String, default `fr` — the locale the patient booked in, captured at Task 7 for later per-language messaging), **whatsappOptIn** (bool, default false — Meta's documented-opt-in requirement for business-initiated WhatsApp messages), **anonymizedAt** (nullable — set when an erasure request is honoured), **createdById** (nullable FK→User), **updatedById** (nullable FK→User), timestamps. **Soft-delete only** (`active=false`); never hard-delete (historical appointments reference it).
- `Service` — id, slug, name (JSON per-locale), description (JSON per-locale), durationMinutes, price (optional), **currency** (default `DZD`), active. Soft-delete only.
- `Appointment` — id, patientId, serviceId, startTime, endTime (= start + service.duration), **all times stored UTC**, status (`PENDING`|`CONFIRMED`|`COMPLETED`|`NO_SHOW`|`CANCELLED`|`RESCHEDULED`), source (`ONLINE`|`MANUAL`), **createdByUserId** (nullable — null for ONLINE bookings), **confirmedAt**/**confirmedByUserId** (nullable — null if never confirmed), **cancelledAt**, **cancelReason** (`STAFF`|`PATIENT_SELF_SERVICE`|`AUTO_EXPIRED`|`CLOSURE`), **completedAt**, **noShowAt**, **reminderSentAt** (nullable — without it a cron retry texts every patient twice), **resourceId** (nullable; unused in v1, reserved for a second chair/practitioner), visitNotes, timestamps. Timestamps per status make KPI queries cheap (no AuditLog walk).
- `Visit` — manual history records: id, patientId, date, serviceId?, type, notes, treatment. **History = `COMPLETED` appointments UNION `Visit` rows.** Visits are for pre-system records or walk-in treatments that never had an appointment. Documented in schema.
- `PatientDocument` — id, patientId, name, **mimeType** (validated against an allow-list), **sizeBytes**, blobKey (private — never a public URL), uploadedById, uploadedAt, **deletedAt**/**deletedById** (soft-delete)
- `WaitlistEntry` — id, patientId, serviceId, preferredDates (**DateTime[]** — clinic-local dates stored as UTC midnight), **source (`PATIENT`|`STAFF`)** — `PATIENT` entries are created by the public booking flow's cancellation-watch opt-in, `STAFF` entries by the dashboard, active, **notifiedAt** (nullable — set and entry deactivated on notification), createdAt. **Delivered early** (with the schema, ahead of Tasks 6/17) so the booking flow can write it.
- `SmsMessage` — id, to (E.164), body, **patientId** (nullable — enables "messages for this patient" queries without phone matching), type (`BOOKING_RECEIVED`|`CONFIRMATION`|`REMINDER`|`NO_SHOW`|`MANUAL`|`RESCHEDULE`|`DELAY`|`WAITLIST`|`EXPIRED` — note: no `BROADCAST`; grouping is encoded by `batchId`; `BOOKING_RECEIVED` added by Task 7 for the "request received, we will call to confirm" message), **templateId** (nullable — lineage to the template version), batchId, provider, status, appointmentId?, sentById, sentAt. **Unique index on (appointmentId, type)** for automated types, so a retried cron cannot double-send.
- `AuditLog` — id, **actorType** (`STAFF`|`SYSTEM`|`PATIENT`), **userId** (nullable — null for SYSTEM and PATIENT actors), **action** (enum), entityType, entityId, detail (JSON), **ipAddress** (nullable), createdAt. **Append-only** — the application never updates or deletes rows.
  - Change actions: `APPOINTMENT_CONFIRMED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_COMPLETED`, `APPOINTMENT_NO_SHOW`, `APPOINTMENT_AUTO_CANCELLED`, `PATIENT_CREATED`, `PATIENT_UPDATED`, `PATIENT_ANONYMIZED`, `SMS_SENT`, `PATIENT_DOCUMENT_UPLOADED`, `PATIENT_DOCUMENT_DELETED`, `TEAM_MEMBER_CREATED`, `TEAM_MEMBER_DEACTIVATED`, `TEAM_MEMBER_ROLE_CHANGED`, `SETTINGS_UPDATED`, `CLOSURE_CREATED`, `CLOSURE_DELETED`, `WAITLIST_ENTRY_ADDED`
  - Access/auth actions *(added — reads matter as much as writes for patient data)*: `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`, `LOGOUT`, `PASSWORD_RESET`, `PATIENT_RECORD_VIEWED`, `PATIENT_DOCUMENT_DOWNLOADED`, `EXPORT_GENERATED`, `AUDIT_VIEWED`
  - Patient-initiated actions: `SELF_SERVICE_CANCELLED`, `SELF_SERVICE_RESCHEDULED`
- `Notification` *(new)* — staff in-app notification feed: id, userId, type (`NEW_BOOKING`|`CANCELLATION`|`WAITLIST_MATCH`|`NO_SHOW_ALERT`|`PENDING_EXPIRED`), payload (JSON), readAt, createdAt. Backs the dashboard notification center; without it, "staff notification" is hand-waved. **Fan-out rule:** one row per **active** staff user, so nothing depends on a particular person being logged in.
- `SelfServiceToken` *(new — now required, not optional)* — id, **tokenHash** (the raw token is never stored), appointmentId, usedAt, revokedAt, expiresAt, createdAt. Gives revocation and replay protection that a stateless signed token cannot. Rescheduling issues a new token and revokes the previous one. Expiry ≤ 48h after the appointment.
- `Setting` — key, **value (JSONB column)**. Working-hours schema documented: `{mon:{open:"10:00",close:"17:00"}, tue:{...}, ... fri:{closed:true}, sat:{...}}` (times are **clinic-local**, Africa/Algiers). Also stores slot granularity, inter-appointment buffer, lunch break, messaging templates, and the booking-policy keys: `pendingExpiryHours` (24), `minLeadTimeMinutes` (120), `maxHorizonDays` (90), `clinicTimezone` (`Africa/Algiers`), `consentVersion`. **Lunch break lives in the `slotConfig` Setting** under the `lunchBreak` key: `null` when no lunch closure, or `{ start: "13:00", end: "14:00" }` (clinic-local HH:mm) when one exists. Task 4's slot engine reads it from there.
- `ScheduleException` *(new)* — id, startDate, endDate, allDay (bool), startTime/endTime (nullable, for partial-day closures), reason (JSON per-locale, shown to patients as "closed"), serviceId (nullable — closure can be global or per service), createdById, createdAt. Subtracted from availability by the slot engine. Covers holidays, Eid, vacation and emergency closures.
- `Testimonial`, `FaqItem`, `GalleryItem` — public content, JSON per-locale fields, `active`, plus a `key String @unique` on each to act as a stable handle for idempotent seeding and future CRUD operations.

## API Endpoints

Next.js App Router route handlers under `/app/api/`. ~50 routes total. Admin routes require staff session + role check via middleware; cron routes authenticate with `CRON_SECRET` header, not user session. **Public write endpoints are rate-limited** (per IP and per phone) and **ADMIN-only routes are marked below** — the same table drives the authorization matrix test.

### Public booking
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/services` | List active services |
| GET | `/api/services/[slug]` | Service detail |
| GET | `/api/slots?serviceId=&date=` | Available slots for service on date |
| POST | `/api/appointments` | Create PENDING appointment (public booking) — rate-limited, consent required; optional `watchDates: string[]` creates a PATIENT-source `WaitlistEntry` in the same transaction (cancellation-watch opt-in) |
| GET | `/api/appointments/[token]` | Self-service lookup — **minimum disclosure only** (service, date/time, clinic info, first name) |
| POST | `/api/appointments/[token]/cancel` | Self-service cancel (audited, actor `PATIENT`) |
| POST | `/api/appointments/[token]/reschedule` | Self-service reschedule into available slot; rotates the token |

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Staff login — throttled, lockout after repeated failures, success/failure audited |
| POST | `/api/auth/logout` | Staff logout |
| GET | `/api/auth/me` | Current staff user |
| POST | `/api/auth/change-password` | Set a new password (required when `mustChangePassword`) |

### Admin — Appointments
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/appointments?date=` | Day view |
| GET | `/api/admin/appointments/pending` | **Call queue** — PENDING bookings awaiting a confirmation call, oldest first, with time left before auto-expiry |
| GET | `/api/admin/appointments/search?q=` | Find an appointment by patient phone or name (for "a patient is on the phone right now") |
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
| POST | `/api/admin/patients/[id]/anonymize` | **ADMIN only** — honour an erasure request (scrub identifiers, keep the appointment shell) |

### Admin — Documents
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/patients/[id]/documents` | Upload (Vercel Blob) |
| GET | `/api/admin/patients/[id]/documents` | List |
| GET | `/api/admin/documents/[id]` | Download — session checked per request, streamed or short-lived signed URL, `attachment` + `nosniff`, audited |
| DELETE | `/api/admin/documents/[id]` | Delete — **ADMIN only**, soft-delete + blob removal, audited |

### Admin — Messaging
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/sms/single` | Single SMS to patient |
| POST | `/api/admin/sms/broadcast/preview` | Recipient list + count **before** sending (no send) |
| POST | `/api/admin/sms/broadcast` | Broadcast to day's appointments (delay template) — **ADMIN only**, requires an idempotency key so a double-click cannot send twice |
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
| GET | `/api/admin/exports/appointments?month=&format=csv\|xlsx` | Monthly export — **ADMIN only**, audited with row count |
| GET | `/api/admin/exports/day-sheet?date=` | Printable day schedule (paper fallback if the site is down) |

### Admin — Team (ADMIN only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/team` | List staff |
| POST | `/api/admin/team` | Create receptionist |
| PATCH | `/api/admin/team/[id]` | Edit / deactivate (bumps tokenVersion) |
| POST | `/api/admin/team/[id]/reset-password` | Issue a one-time password reset (bumps tokenVersion, sets `mustChangePassword`, audited) |

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
| PATCH | `/api/admin/settings` | Update (working hours, slot config, booking policy, templates) — **ADMIN only** |
| GET | `/api/admin/closures` | List closure dates |
| POST | `/api/admin/closures` | Create closure — **ADMIN only**; returns affected appointments for confirmation |
| DELETE | `/api/admin/closures/[id]` | Remove closure — **ADMIN only** |
| GET | `/api/admin/audit?userId=&entityType=&from=` | Audit log query — **ADMIN only**, read is itself audited |
| GET | `/api/admin/notifications` | Staff notification feed |
| PATCH | `/api/admin/notifications/[id]/read` | Mark read |

### Cron (Vercel Cron → route handlers; `CRON_SECRET` auth via the `x-cron-secret` request header)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cron/cleanup` | Prune expired rate-limit counter rows (idempotent) — delivered early so the rate-limit table never grows unbounded |
| GET | `/api/cron/reminders` | 24h-before reminders to CONFIRMED appointments — idempotent (`reminderSentAt`) |
| GET | `/api/cron/no-show-followup` | Mark NO_SHOW + send follow-up SMS — idempotent |
| GET | `/api/cron/expire-pending` | Auto-cancel unconfirmed PENDING bookings via `releaseSlot()` (frees the slot, triggers waitlist) |
| GET | `/api/health` | Uptime probe (no auth, no data) |

## Code Structure

Target directory layout. Created incrementally per task (empty dirs aren't tracked by git — the structure materializes as files land). Task 1 creates the skeleton; every later task fills its slice.

```
orthocare-clinic/
├── .github/workflows/ci.yml        # CI: build + lint + typecheck + test (Task 1)
├── .env.example                    # DATABASE_URL, MESSAGE_PROVIDER, CRON_SECRET, ...
├── next.config.ts                  # security headers + CSP (Task 23)
├── tailwind.config.ts
├── tsconfig.json                   # paths: "@/*" → "./src/*"
├── vitest.config.ts
├── package.json
├── prisma/
│   ├── schema.prisma               # grows across Tasks 3a/3b/3c (lazy)
│   └── seed.ts
├── messages/                       # next-intl UI strings (chrome: nav, buttons, labels)
│   ├── fr.json
│   ├── ar.json
│   └── en.json
├── tests/
│   ├── setup.ts                    # test DB reset between suites
│   ├── authz-matrix.test.ts        # every admin route × every role (Task 12, updated forever after)
│   └── integration/                # route-level tests (booking, self-service, waitlist)
└── src/
    ├── middleware.ts               # locale negotiation + /admin auth guard
    ├── app/
    │   ├── [locale]/               # PUBLIC SITE — trilingual, RTL-aware
    │   │   ├── layout.tsx          # html dir=rtl for ar, Header/Footer
    │   │   ├── page.tsx            # home / hero
    │   │   ├── services/page.tsx
    │   │   ├── services/[slug]/page.tsx
    │   │   ├── book/page.tsx       # booking wizard (Task 6)
    │   │   ├── appointment/[token]/page.tsx   # self-service cancel/reschedule (Task 8)
    │   │   ├── faq/page.tsx
    │   │   ├── privacy/page.tsx    # privacy notice, 3 locales (Task 11)
    │   │   ├── testimonials/page.tsx
    │   │   ├── gallery/page.tsx
    │   │   ├── about/page.tsx
    │   │   └── contact/page.tsx
    │   ├── admin/                  # DASHBOARD — FR-only, OUTSIDE [locale] (no /fr/admin)
    │   │   ├── layout.tsx          # session guard + sidebar + notification bell
    │   │   ├── login/page.tsx
    │   │   ├── page.tsx            # dashboard home → KPIs (Task 18)
    │   │   ├── appointments/page.tsx       # day view + call queue + search (Task 14)
    │   │   ├── patients/page.tsx           # list + search (Task 13)
    │   │   ├── patients/[id]/page.tsx      # profile + history + documents
    │   │   ├── sms/page.tsx                # SMS center (Task 16)
    │   │   ├── waitlist/page.tsx           # (Task 17)
    │   │   ├── team/page.tsx               # (Task 20)
    │   │   ├── content/page.tsx            # services/testimonials/FAQ/gallery (Task 21)
    │   │   ├── settings/page.tsx           # working hours, booking policy, templates (Task 21)
    │   │   ├── closures/page.tsx           # holidays / vacation / closures (Task 21)
    │   │   └── audit/page.tsx              # audit log viewer, ADMIN only (Task 12)
    │   └── api/                    # ~50 route handlers — mirrors endpoint table above
    │       ├── services/route.ts + [slug]/route.ts
    │       ├── slots/route.ts
    │       ├── appointments/route.ts + [token]/{route,reschedule}.ts
    │       ├── auth/{login,logout,me}/route.ts
    │       ├── admin/{appointments,patients,documents,sms,waitlist,kpis,exports,team,services,testimonials,faqs,gallery,settings,audit,notifications}/...
    │       └── cron/{cleanup,reminders,no-show-followup,expire-pending}/route.ts
    ├── components/
    │   ├── public/                 # Header, Footer, Hero, LocaleSwitcher,
    │   │   │                       # BookingWizard/ (step components), SlotPicker,
    │   │   │                       # GoogleReviews, GoogleMaps, ContentSections
    │   ├── admin/                  # Sidebar, DayView, AppointmentCard, PatientForm,
    │   │                           # DuplicateWarning, SmsComposer, KpiCards, DataTable
    │   └── ui/                     # primitives: Button, Input, Modal, Badge, Select...
    ├── lib/                        # domain logic — framework-free where possible
    │   ├── db.ts                   # Prisma client singleton
    │   ├── i18n/
    │   │   ├── config.ts           # locales, default, RTL map
    │   │   └── localized.ts        # localized(field, locale) + fallback (Task 2)
    │   ├── time/
    │   │   └── clinicTime.ts       # UTC ↔ Africa/Algiers conversion, single source of truth (Task 4)
    │   ├── phone/
    │   │   └── normalize.ts        # E.164 normalization + display format (Task 3a)
    │   ├── slots/                  # PURE slot engine (Task 4) — zero Next.js imports
    │   │   ├── workingHours.ts     # parse Setting JSON → day windows
    │   │   ├── exceptions.ts       # subtract ScheduleException closures (Task 4)
    │   │   ├── policy.ts           # lead time, horizon, past-date rules (Task 4)
    │   │   ├── engine.ts           # generateSlots, overlaps, availability
    │   │   └── engine.test.ts      # colocated unit tests
    │   ├── booking/                # (Task 5)
    │   │   ├── bookSlot.ts         # transactional insert + in-tx re-check
    │   │   ├── releaseSlot.ts      # shared cancel path → emits slot-freed
    │   │   └── events.ts           # slot-freed emitter (waitlist subscribes, Task 17)
    │   ├── auth/                   # (Task 12)
    │   │   ├── session.ts          # signed cookie, tokenVersion check, idle/absolute expiry
    │   │   ├── csrf.ts             # origin check on state-changing requests
    │   │   └── password.ts         # hash/verify (argon2id), policy, reset
    │   ├── security/
    │   │   ├── rateLimit.ts        # per-IP / per-phone counters, Postgres-backed (Task 1)
    │   │   ├── clientIp.ts         # getClientIp(): trusted proxy header only, anti-spoof (delivered early)
    │   │   └── headers.ts          # CSP + security header helpers (SECURITY_HEADERS / NO_REFERRER_HEADERS)
    │   ├── messaging/              # (Task 7)
    │   │   ├── provider.ts         # MessageProvider interface
    │   │   ├── mock.ts / twilio.ts / whatsapp.ts
    │   │   ├── templates.ts        # render from Settings templates
    │   │   └── index.ts            # env-selected factory
    │   ├── audit/logAction.ts      # (Task 12)
    │   ├── patients/duplicates.ts  # (Task 13)
    │   ├── selfservice/tokens.ts   # SelfServiceToken create/verify (Task 8)
    │   ├── kpis/aggregations.ts    # pure functions + tests (Task 18)
    │   ├── export/{csv,xlsx}.ts    # (Task 19)
    │   ├── seo/jsonld.ts           # Dentist/MedicalBusiness structured data (Task 23)
    │   ├── privacy/anonymize.ts    # erasure-by-anonymization (Task 13)
    │   └── cron/{reminders,noShow,expirePending}.ts   # logic, thin routes call these (Task 9)
    ├── schemas/                    # zod request validation per endpoint group
    │   ├── booking.ts, patients.ts, appointments.ts, sms.ts, ...
    │   └── (shared types re-exported to client forms)
    └── types/                      # shared domain types (Status, Role, locales)
```

**Structural decisions:**

1. **`src/` layout** — root stays clean with this many top-level dirs; `middleware.ts` lives in `src/` (Next.js requirement when using `src/`).
2. **Admin outside `[locale]`** — `/admin` is a canonical URL, FR-only by construction. No `/fr/admin`, no locale switcher in dashboard. Middleware guards it separately from public routes.
3. **Self-service under `[locale]`** — patients open cancellation links in their language; the SMS link embeds the locale (`/ar/appointment/[token]`).
4. **Pure domain logic in `lib/`** — slot engine, KPI aggregations, duplicate detection, and booking functions import **zero** Next.js modules. Unit-testable in isolation; route handlers stay thin (validate → call lib → respond).
5. **`lib/booking/events.ts`** — the slot-freed event from the dependency graph lives here. `releaseSlot()` emits; waitlist (Task 17) subscribes. Self-service and staff cancels both flow through it by construction.
6. **Colocated unit tests + `tests/integration/`** — `engine.test.ts` sits next to `engine.ts`; route-level tests that need the test DB live in `tests/integration/`.
7. **Zod schemas in `src/schemas/`** — one module per endpoint group; shared between route handlers and client forms. (Zod added to dependencies — small addition to Architecture Decisions.)
8. **`messages/` vs DB content** — UI chrome (nav, buttons, labels) in JSON files; CMS content (services, FAQ, testimonials) in DB via `localized()`. Two clear sources: translatable-by-dev vs editable-by-clinic.
9. **Component boundaries** — `components/public/` never imports from `components/admin/` and vice versa; shared primitives only from `components/ui/`.
10. **Cron logic in `lib/cron/`** — route handlers are thin wrappers (auth + call lib); logic is testable without HTTP. Every cron function is **idempotent**: running it twice produces the same result and sends no duplicate message.
11. **One place converts time** — `lib/time/clinicTime.ts` is the only module that knows the clinic timezone. Nothing else does date maths on local time, which is how one-hour drift bugs get in.
12. **One place normalizes phone numbers** — `lib/phone/normalize.ts` is called on every write path (booking, manual create, import). Duplicate detection and messaging both read the normalized field only.
13. **One place enforces authorization** — a `requireRole()` guard used by every admin route handler, with the route/role table mirrored in `tests/authz-matrix.test.ts`. Adding a route means adding a row to the test.

**Which task creates what:**
- Task 1: root config files, `prisma/`, `messages/` (empty skeletons), `src/app` shell, CI, `lib/security/rateLimit.ts`, staging environment
- Task 2: `messages/*.json`, `src/lib/i18n/`, `components/public/` shell, `[locale]/layout.tsx`
- Task 3a/3b: `prisma/schema.prisma` + `seed.ts`
- Task 4: `lib/slots/` (pure + tests), `lib/time/clinicTime.ts`
- Task 5: `lib/booking/` (bookSlot, releaseSlot, events)
- Tasks 6-11: `[locale]` pages + `components/public/` + `api/` public routes
- Tasks 12-21: `/admin` pages + `components/admin/` + `api/admin/` routes
- Tasks 22-23: provider impls + deploy config + `lib/seo/jsonld.ts` + security headers

## Dependency Graph

```
Prisma schema (split across 3a/3b/3c — see Task List)
   3a: User, Patient, Service, Appointment        → engine + auth + bookings
   3b: Testimonial, FaqItem, GalleryItem, Setting,
       ScheduleException                           → public content + admin content mgmt + closures
   3c: SmsMessage, AuditLog, Notification,
       Visit, PatientDocument,
       SelfServiceToken                            → added lazily as features land
       (WaitlistEntry delivered early, alongside the slot-freed event's
        serviceId field — the public booking flow (Task 6) writes
        PATIENT-source entries at booking time)
        │
        ├── Slot engine (pure logic: working hours, closures, booking policy,
        │                 clinic-timezone conversion, slot gen, overlap)
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
        │        └── Reminders + no-show + expire-pending cron (mock provider)
        │             (all idempotent; expiry calls releaseSlot → waitlist fires)
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

**Dependency changes introduced by this revision** *(flagged explicitly — these alter existing task inputs)*:
- **`logAction()` signature changed** from `(userId, …)` to `(actor, …)` where actor is `STAFF | SYSTEM | PATIENT`. Tasks 13–21 only *call* the helper, so this is cheap now and expensive after nine call sites exist. Tasks 8, 9 and 17 previously had **no valid value to pass** — they act as PATIENT and SYSTEM.
- **Task 4 gains two inputs** — `ScheduleException` closures and the booking-policy settings. Both must land in **Task 3b**, otherwise Task 4 is written against an incomplete model and reworked.
- **Task 3a gains fields consumed later** — `phoneE164` (Tasks 6, 7, 13), `reminderSentAt` (Task 9), consent fields (Tasks 6, 7), `cancelReason` (Tasks 8, 9, 14).
- **Task 1 gains the rate-limit store and the staging environment.** Task 22's verification already assumed staging existed; nothing created it.
- **Task 15 changes approach, not order** — private blob + authenticated download route rather than a public blob URL. Same dependency (Task 13).
- **No task numbers changed.** Every addition folds into an existing task, so no existing dependency is broken.

## Task List

> Tasks tracked in `tasks/todo.md`. Renumbered from v1 — see "Key dependency corrections" above for the rationale. Acceptance criteria + verification per task live in `tasks/todo.md`.

**Sizing and sequencing** (one developer; day estimates live per task in `tasks/todo.md`)

| Phase | Tasks | Estimate | Notes |
|---|---|---|---|
| 1. Foundation | 1–2 | 3–5 days | Nothing else can start |
| 2. Scheduling engine | 3a–5 | 8–12 days | **Highest risk, on the critical path** |
| 3. Public booking + comms | 6–11 | 13–18 days | Tasks 10 and 11 can run in parallel |
| 4. Admin core | 12–15 | 13–17 days | Task 12 gates everything after it |
| 5. Admin ops | 16–21 | 11–14 days | Mostly parallelizable |
| 6. Production readiness | 22–23 | 5–7 days | WhatsApp template approval has external lead time |
| **Total** | | **~54–73 days** | ≈ 13–18 weeks at 75% capacity |

**Critical path:** 1 → 3a → 4 → 5 → 6 → 12 → 13 → 14 → 23. A day lost here is a day lost overall.
**Parallelizable / can slip safely:** 10 (Google Reviews), 11 (content pages), 18–21 (admin ops).
**Cut list if time runs short, in order:** Task 10 → Task 19 (export) → Task 17 (waitlist) → advanced KPIs in Task 18. **Never cut** the security items in Tasks 12 and 15, the authorization matrix test, or the backup restore drill — those are the ones that are painful to retrofit.
**Plan to ~75% of available time.** Interruptions, clinic feedback rounds and provider paperwork are certain, not hypothetical.

### Phase 1: Foundation
- [ ] Task 1: Scaffold project (Next.js + TS + Tailwind + ESLint + Prisma + Postgres + Vitest + Vercel Blob + GitHub Actions CI) + rate-limit store + **staging environment**
- [ ] Task 2: i18n foundation + site shell + `localized()` DB helper (header, footer, hero, nav, locale switcher, RTL)

### Checkpoint: Foundation
- [ ] App builds clean, lint + typecheck pass, CI green
- [ ] 3 locales render with correct direction (RTL for Arabic)
- [ ] Postgres connected, `prisma migrate` works against dev + test DBs
- [ ] `localized()` helper unit-tested with FR fallback
- [ ] Staging environment reachable with its own database and synthetic data only

### Phase 2: Scheduling Engine (high-risk, built first — no UI)
- [ ] Task 3a: Core schema (User, Patient, Service, Appointment) + phone normalization + consent fields + `reminderSentAt` + migration + minimal seed (no default admin password in any shared environment)
- [ ] Task 3b: Content schema (Testimonial, FaqItem, GalleryItem, Setting, **ScheduleException**) + booking-policy settings + full seed from current site
- [ ] Task 4: Slot engine — pure functions: clinic-timezone conversion, working hours lookup, **closure subtraction**, **booking-window policy**, slot generation per service, overlap detection, availability query (unit-tested)
- [x] Task 5: Atomic booking action + `releaseSlot()` shared function — transactional book with in-transaction availability re-check + conflict error; `releaseSlot()` emits slot-freed event (concurrency-tested)

### Checkpoint: Engine correct
- [x] Slot engine unit tests pass (overlap, boundaries, lunch, buffer, closures, lead time, horizon)
- [x] Times behave correctly across the UTC ↔ Africa/Algiers boundary (00:00 and 23:59 local)
- [x] Concurrent bookings of the same slot: exactly one succeeds
- [x] Booked slot renders as reserved in availability query (Task 6 — needs the route)
- [x] `releaseSlot()` event fires on cancellation

### Phase 3: Public Booking + Communication
- [ ] Task 6: Booking wizard UI + `POST /api/appointments` + `GET /api/slots` — pick service → date → available/occupied slots → patient info + **consent** → confirm → summary; rate-limited (integration-tested: happy + conflict paths)
- [ ] Task 7: Message abstraction + providers (Mock, Twilio-ready, WhatsApp) + `SmsMessage` + `Notification` models — confirmation on booking + staff dashboard notification
- [ ] Task 8: Self-service link — `SelfServiceToken` (revocable) in confirmation SMS; cancel + reschedule, both routing through `releaseSlot()` (Task 5)
- [ ] Task 9: Reminders + no-show follow-up + **PENDING auto-expiry** cron (Vercel Cron, mock provider) — all idempotent; expiry routes through `releaseSlot()`
- [ ] Task 10: Google Reviews embed widget (+ 4★ filter if confirmed) + Google Maps location (embed + one-click directions)
- [ ] Task 11: Public content pages — services list/detail, FAQ, testimonials, gallery, about, contact, **privacy notice** (uses `localized()` helper, depends on Task 3b content schema)

### Checkpoint: Public booking works end-to-end
- [ ] Patient books an available slot; slot shows as reserved afterwards
- [ ] Consent recorded; booking rejected without it
- [ ] Booking-received SMS sent (mock provider); staff in-app notification fires
- [ ] Self-service cancel/reschedule works; `releaseSlot()` fires + slot reflects change; page exposes only minimum data
- [ ] Reminders + no-show + expiry cron run against seeded data (mock SMS logged); **running each twice sends exactly one message**
- [ ] Rate limits reject a booking flood from one IP/phone
- [ ] Google Reviews widget renders live rating across all 3 locales; map + one-click directions work
- [ ] Public content pages render in all 3 locales with FR fallback

### Phase 4: Admin Core
- [ ] Task 12: Auth + RBAC + audit helper + dashboard shell — staff login (throttled, lockout), CSRF + cookie hardening, sessions (tokenVersion revocation), middleware, `/admin` shell, role-gated nav, `logAction(actor, …)` helper, `AuditLog` model, audit viewer, **authorization matrix test** (deps: 3a — **not** Task 7)
- [ ] Task 13: Patient records + duplicate detection — CRUD, visit history timeline (COMPLETED appointments UNION Visits), notes, phone/name duplicate flagging (deps: Task 12)
- [ ] Task 14: Appointment management — day view, **call queue** (PENDING awaiting call), **search by phone/name**, confirm-after-call, cancel, reschedule (re-checks availability), mark completed/no-show, manual booking creation (deps: Task 13 — manual booking needs patient CRUD)
- [ ] Task 15: Patient documents — **private** Blob storage + authenticated download route, MIME allow-list + size cap, patient-scoped, staff-only, downloads audited (deps: Task 13)

### Checkpoint: Admin scheduling loop
- [ ] Receptionist confirms/cancels/reschedules; each action audited + SMS fires
- [ ] Call queue lists bookings awaiting a confirmation call, oldest first
- [ ] Appointment findable by phone or name while the patient is on the line
- [ ] Manual booking appears in slot availability; completed visit saved to history
- [ ] Duplicate patient flagged on creation; documents scoped + staff-only
- [ ] Document URL alone (no session) does **not** grant access; download audited
- [ ] Deactivated staff session revoked immediately (tokenVersion bump)
- [ ] Authorization matrix test green for every admin route × every role

### Phase 5: Admin Ops
- [ ] Task 16: SMS Center — manual single SMS + broadcast with delay template ("delayed by X min"), **recipient preview + idempotency key**, opt-out respected; send history with batchId (deps: Task 14, Task 13)
- [ ] Task 17: Waitlist — entries per patient/service; subscribes to slot-freed event from `releaseSlot()` so it fires on **both** staff and self-service cancellations (deps: Task 14, Task 8)
- [ ] Task 18: KPIs overview — today's schedule, utilization rate, no-shows, new patients/month (unit-tested aggregations; deps: Task 14)
- [ ] Task 19: CSV/Excel export — monthly activity report (ADMIN-only, audited) + printable day sheet (deps: Task 18)
- [ ] Task 20: Team management — admin creates/edits/deactivates receptionist accounts + issues password resets (deps: Task 12)
- [ ] Task 21: Content management + settings — services (incl. durations), gallery, testimonials, FAQ, working hours/slot config, **closure dates**, booking policy, messaging templates (deps: Task 12, Task 3b)

### Checkpoint: Admin ops complete
- [ ] Broadcast + waitlist + no-show flows verified
- [ ] Broadcast shows a recipient count before sending; a double-click sends once
- [ ] Opted-out patients excluded from non-transactional messages
- [ ] Waitlist fires on self-service cancellation (not just staff)
- [ ] Closure date blocks new bookings and surfaces affected existing appointments
- [ ] KPIs and exports produce correct numbers (unit-tested); export is ADMIN-only and audited
- [ ] Role restrictions enforced (receptionist cannot manage team/settings)

### Phase 6: Production Readiness
- [ ] Task 22: Twilio + WhatsApp provider wiring — flip `MESSAGE_PROVIDER` from mock to real; verify against a real DZ number (deps: Task 16)
- [ ] Task 23: SEO (**hreflang, 301 redirects, JSON-LD, canonicals**), sitemap, robots.txt, performance pass (Arabic font subsetting, gallery optimization), security headers/CSP, Sentry with PII scrubbing, uptime monitoring, **backup restore drill**, cutover + rollback, deploy to Vercel, env config, handoff docs (deps: Task 21, Task 22)

### Checkpoint: Complete
- [ ] All acceptance criteria met (see tasks/todo.md)
- [ ] Deployed to Vercel; real SMS/WhatsApp verified against DZ number
- [ ] Sentry capturing errors **with PII scrubbed**; uptime + cron alerts live
- [ ] Database restore tested from backup, not just configured
- [ ] 301 redirects live from all old URLs; hreflang + JSON-LD validate
- [ ] Privacy notice published in 3 locales; retention policy written
- [ ] Handoff documentation ready for clinic owner

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
| Scope creep (many features) | Med | Vertical slices with working checkpoints; features 4 & 6 dropped; explicit Non-Goals list; remaining locked per confirmed set |
| Booking flood fills the calendar (no login needed to book) | High | Rate limits per IP and per phone, cap on active PENDING per phone, PENDING auto-expiry, optional bot check |
| Staff password brute-forced | High | Login throttling + temporary lockout, argon2id, 12-char minimum, failures audited |
| Public blob URL exposes an X-ray permanently | High | Private storage + authenticated download route; MIME allow-list; `attachment` + `nosniff`; downloads audited |
| Timezone drift between UTC hosting and clinic-local hours | High | Single `clinicTime` module; UTC storage, local computation; boundary tests at 00:00/23:59 |
| Cron retry double-texts every patient | Med | `reminderSentAt` + unique index on `SmsMessage(appointmentId, type)`; idempotency tested by running each job twice |
| Patients book on a day the clinic is closed | Med | `ScheduleException` closures subtracted from availability; affected existing appointments surfaced, never dropped silently |
| Duplicate detection silently fails on phone formats | Med | E.164 normalization on every write; normalized field indexed and used for matching and messaging |
| Self-service token leaks via referrer or forwarded SMS | Med | `Referrer-Policy: no-referrer`, no third-party scripts on token pages, minimum disclosure, rotation on reschedule, rate limits |
| Broadcast misfire messages every patient twice | Med | Recipient preview + count, idempotency key, ADMIN-only, logged with batchId |
| Bulk export leaks patient data | Med | ADMIN-only, audited with row count, clinical notes excluded by default |
| PII shipped to error monitor / third parties | Med | `sendDefaultPii: false`, `beforeSend` scrubbing, token masking, processors listed in privacy notice |
| Cross-border transfer under Law 18-07 (hosting/DB/SMS/Sentry outside Algeria) | Med | Processors documented in the privacy notice; confirm declaration/authorization requirements with the clinic before go-live |
| Erasure request conflicts with never-hard-delete rule | Med | Anonymization path (`anonymizedAt`) keeps statistics intact; ADMIN-only and audited |
| Data loss with no tested restore | High | Point-in-time recovery enabled, Blob backups, **restore drill before go-live**, printable day sheet as paper fallback |
| Site unreachable during clinic hours | Med | Uptime + cron alerting; printable day sheet; documented rollback (revert DNS) |
| Ranking lost when replacing the live domain | Med | 301 redirects from every old URL, hreflang, canonicals, JSON-LD, per-locale sitemaps resubmitted |
| 4★-and-up review filter adds a key/billing dependency | Low | Default to the free embed; only take the Places API route if the clinic confirms it's worth the key + cost; cache server-side |
| Slow public site on mobile networks (Arabic fonts, gallery) | Med | Font subsetting, image optimization + lazy loading, caching/ISR for content pages, bundle budget in Task 23 |
| Clinic actually has more than one chair | High | Single-resource assumption stated and confirmed before Task 4; `resourceId` seam kept in the engine so adding chairs is inputs, not a rewrite |
| WhatsApp template approval delays go-live | Med | Submit templates early in Phase 3; SMS remains the fallback channel; tracked as an Open Question |
| Privileged action taken with no trace | Med | Audit covers reads, downloads, exports and logins; append-only; ADMIN-only to read; access-control regression caught by the authorization matrix test |

## Open Questions
- **How many patients can the clinic treat at the same time (chairs/practitioners)?** *Blocking Task 4* — v1 assumes exactly one. If the answer is two or more, the availability model changes before the engine is built, not after.
- **Cross-border data processing under Law 18-07** — hosting, database, messaging and error monitoring all sit outside Algeria. Does the clinic need a declaration or authorization? Paperwork with a lead time; settle before go-live.
- **Retention windows** — how long to keep message bodies, audit logs and patient documents? Needed to finish the retention policy.
- **WhatsApp opt-in wording and template approval** — Meta review has external lead time; start in Phase 3 or accept SMS-only at launch.
- **Arabic numerals** — Eastern (٠١٢٣) or Western (0123) for times and dates in the Arabic locale? Affects the slot picker and every date display.
- Exact durations per service (est. to be confirmed with the clinic); defaults editable in dashboard
- Real messaging provider at go-live (Twilio vs local DZ SMS provider vs WhatsApp Business API) — Task 22 decides; interface keeps it swappable
- Does the clinic want a lunch break in the schedule? (Assumed configurable, default off)
- Broadcast + no-show SMS permissions: admin-only, or also receptionist? (Assumed admin-only for broadcasts; receptionist can send single SMS)
- **Google Reviews 4★ filter** — the free embed can't filter by rating. To show only 4★+ reviews requires the Google Places API (API key + usage billing + server-side caching). Default for Task 10 is the free embed; decide whether the 4★ filter is worth the key/cost.
- ~~Admin dashboard language: FR only, or also AR/EN?~~ **Resolved: FR-only dashboard, trilingual public site.**

---

# Refinement: Task 6 — Booking UI/UX

## Overview

A focused redesign of the public booking wizard's date/time selection, driven by three concrete clinic feedback items:

1. **Lighter background** — the booking page currently falls back to a near-black background (`#0a0a0a`) when the visitor's OS is in dark mode, because `src/app/globals.css` has a `@media (prefers-color-scheme: dark)` override. Every component in the wizard already uses hardcoded light Tailwind classes (`bg-white`, `text-zinc-900`, `border-zinc-200`, teal accents), so dark mode was never actually supported — it only flips the page shell to black, leaving light cards floating on it. Pin the background to a light surface, always.
2. **Combined day + time selection** — today the wizard is 5 steps: **service → date → slot → info → summary**. Day and time live in two separate steps. Merge them into one: a swipeable day carousel where moving to a day shows that day's times directly beneath, in the same step. The wizard becomes 4 steps: **service → date & time → info → summary**.
3. **Taken times inline and red** — today `SlotPicker` splits `available` and `occupied` into two separate fieldsets (available first, reserved second). Merge them into one list ordered by time, with already-taken slots rendered **red, disabled, and not clickable**, interleaved in their natural chronological position.

No backend changes. The `GET /api/slots` route already returns `{ available: SlotDto[], occupied: SlotDto[] }` (both with `startUTC` + `localTime`), so the merged time grid is a pure frontend restructure.

## Architecture Decisions

- **Light background, pinned.** Remove the `prefers-color-scheme: dark` block in `src/app/globals.css` and set `--background` to a light neutral (`#f8fafc` / zinc-50) so the white wizard cards separate from the page shell without a harsh pure-white edge. This is a **site-wide** change, which is correct: Header, Footer, Hero, Nav and every public page already use the same hardcoded light palette, so the dark override was broken everywhere, not just on the booking page. No new dependency; no theme system introduced (out of scope for this refinement).
- **No carousel library.** Build the swipeable day strip with native CSS scroll-snap (`scroll-snap-type: x mandatory` + per-day `snap-start`). This gives touch swipe, trackpad drag, native momentum, and — combined with a focusable container + arrow-key handler — keyboard navigation. The `dir` attribute from `[locale]/layout.tsx` (`dir="rtl"` for Arabic) automatically reverses scroll direction and chevron semantics; the existing `rtl:-scale-x-100` pattern already used in `BackButton` is reused for arrows. Adding `embla-carousel` or similar was considered and rejected: it would be a new dependency (the security audit recorded "no new deps" as a positive) for behavior the platform already provides.
- **Composition, not configuration.** Per the frontend-ui-engineering skill: two focused presentational components, composed in the wizard.
  - `TimeGrid.tsx` — pure: merges `available` + `occupied`, sorts by `startUTC`, renders one chronological grid. Occupied slots are red + `disabled` + carry a visible text label (reusing the existing `slotReserved` message) — **never color alone** (WCAG: color is not the sole indicator of state).
  - `DayCarousel.tsx` — pure: scroll-snap day strip, keyboard arrows, RTL-aware, emits the active day; takes a `renderDay(date)` slot so it does not depend on `TimeGrid`.
  - The wizard's new combined step composes both, owns the slot-loading state, and advances to the patient-info step on time selection.
- **Merge + sort as a pure, unit-tested helper.** `mergeSlots(available, occupied)` returns one array `{ startUTC, localTime, status: "available" | "occupied" }` sorted by `startUTC`. It is a pure function in `lib/booking/` (zero React imports) and gets a unit test — the project's established pattern for logic that matters (engine, normalize). The component is a thin render over its output.
- **Lazy per-day slot loading.** Only the active (snapped) day fetches `GET /api/slots`; fetched days are cached in component state so swiping back does not refetch. Reuses the wizard's existing `loadSlots(serviceId, date)`. The cancellation-watch pre-suggest (days browsed with zero availability are remembered for the summary step) is preserved — it already lives in `loadSlots` and stays there.
- **Step merge, not a new flow.** Steps 2 (date) and 3 (slot) collapse into one "Date & time" step. `StepIndicator` goes from 5 to 4 steps. Recap chips (service / date / time), the conflict redirect (409 → return to the date/time step), and the success screen are unchanged. The existing `booking-flow` and `create-booking` integration tests hit the **API** (`POST /api/appointments`, `GET /api/slots`), not the React wizard, so they are unaffected — the API contract is unchanged.
- **i18n.** Add a small set of keys to `messages/{fr,ar,en}.json` under `Booking`: `stepDateTime` (combined step label), `dayCarouselLabel` (aria-label for the strip), `prevDay` / `nextDay` (arrow button labels + `aria-label`), `jumpToDate` (the existing `otherDate` native input is kept as the far-out-date escape hatch). Reuse existing `chooseDateHint`, `noSlots`, `slotAvailable`, `slotReserved`, `reservedSlots`. RTL verified for Arabic.
- **Verification level.** Per the project's Definition of Done (todo.md): **unit tests for pure logic** (`mergeSlots` sort + de-dup) and **manual verification for UI/i18n/RTL** (no DOM/component test framework is configured). Each task's verification includes a keyboard-only pass and an RTL pass.

## Task List (Refinement)

Sliced so each task leaves a working system. 6R-1 is independent; 6R-2 and 6R-3 are independent presentational components; 6R-4 composes them and merges the wizard steps.

- [x] Task 6R-1: Pin a light page background (remove the dark-mode override)
- [x] Task 6R-2: `TimeGrid` — merged, time-sorted grid; occupied slots red + disabled + labeled
- [x] Task 6R-3: `DayCarousel` — scroll-snap day strip with swipe + keyboard + RTL
- [x] Task 6R-4: Combined "Date & time" wizard step (merge steps 2+3) + i18n + StepIndicator

### Checkpoint: After Task 6R-1 → 6R-4 (Booking UI/UX refinement)
- [ ] Booking page is light in both light and dark OS mode (no near-black shell)
- [ ] Day and time selection happen in one step; swiping/moving the day strip shows that day's times beneath
- [ ] Taken times appear inline in chronological order, red, disabled, not clickable, with a text label
- [ ] Wizard is 4 steps; StepIndicator reflects the merge
- [ ] Works in FR / AR (RTL) / EN; keyboard-only can select service → day → time → continue
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all green
- [ ] Existing booking-flow + create-booking integration tests still pass (API contract unchanged)
- [ ] Review with human before proceeding

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Color-only signaling for taken slots (red only) fails WCAG | Med | Pair red with a text label (`slotReserved`), `disabled` + `aria-disabled`, and a line-through; state conveyed by text + interaction, not color alone |
| Scroll-snap carousel keyboard-inaccessible | Med | Container is `tabIndex=0` with `aria-label`; Left/Right arrows move the active day; active day announced via `aria-pressed`/`aria-current`; visible focus ring |
| RTL swipe direction feels wrong in Arabic | Med | `dir="rtl"` reverses scroll direction natively; chevrons use `rtl:-scale-x-100`; verify manually in `/ar/book` |
| Per-day fetches hit the 120/min slots rate limit | Low | Only the active day fetches; results cached; 90 days of swiping is well under 120/min in normal use |
| Breaking the 5-step flow breaks existing behavior users expect | Low | The merge is additive to UX (fewer steps, same data); conflict/watch/conflict-redirect paths preserved; integration tests unchanged |
| Removing dark mode site-wide is unexpected | Low | Dark mode was already broken (hardcoded light classes on a black shell); this refinement makes reality match design; documented as a decision |

## Open Questions

- **Day carousel scope.** Recommended: the carousel covers the full bookable window (today → `maxHorizonDays`, default 90), rendered as scroll-snap day cards, with slots lazy-loaded for the active day and cached. Alternative (less work, matches today): a 14-day swipeable strip + a "jump to date" native input for far-out dates. The 14-day version is the safe default; the full-window version is a follow-up if the clinic wants pure swipe-through-90. **Decision needed before 6R-3.**
- **Background tint.** Recommended: light neutral `#f8fafc` (zinc-50) for the page shell so white cards lift. Alternative: pure white `#ffffff`. Minor; confirm with the clinic.
- **Carousel layout.** Recommended: a full-width day card (date header + that day's time grid) that snaps into view — the most literal reading of "swipe through the days and see the times for each day." Alternative: a compact day-chip strip above a time grid that updates on selection. The full-width card is the recommendation; the chip-strip is the fallback if the clinic finds full-width too tall.