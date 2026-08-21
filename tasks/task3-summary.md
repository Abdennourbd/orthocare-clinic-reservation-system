# Task 3 — Scheduling-engine foundation: core + content schema (summary)

What was done in Task 3: the domain and content data model (Prisma schema),
phone normalization, the full production seed, and the migrations that back
the slot engine (Task 4) and everything after. Split into Task 3a (core) and
Task 3b (content), as planned in `tasks/todo.md` / `tasks/plan.md`.

## Done + verified (all green)

### Task 3a — Core schema

- **Prisma models** (`prisma/schema.prisma`):
  - `User` — role enum (`ADMIN`/`RECEPTIONIST`), `tokenVersion`,
    `mustChangePassword`, `lastLoginAt`, `failedLoginCount`, `lockedUntil`,
    soft-delete (`active`).
  - `Patient` — `firstName/lastName`, `phone` (as typed) + **`phoneE164`
    indexed (non-unique)**, email, birthDate, notes, `consentAt` /
    `consentVersion`, `messagingOptOut`, `anonymizedAt`, soft-delete, audit FKs
    `createdById`/`updatedById`.
  - `Service` — `slug` unique, JSON per-locale `name`/`description`,
    `durationMinutes`, `price`, `currency` (DZD), soft-delete.
  - `Appointment` — `startTime`/`endTime` (UTC), `status` enum
    (PENDING/CONFIRMED/COMPLETED/NO_SHOW/CANCELLED/RESCHEDULED), `source`
    (ONLINE/MANUAL), nullable actor FKs, per-status timestamps
    (`confirmedAt`/`cancelledAt`/`completedAt`/`noShowAt`), `reminderSentAt`,
    `cancelReason`, `resourceId` (reserved, unused in v1), `visitNotes`.
- **Phone normalization** — `src/lib/phone/normalize.ts` → E.164 (`+213…`).
  Handles `0550…`, `+213…`, `00213…`, `213…`, with spaces; also **mobile vs
  fixed-line prefixes and Arabic-Indic (٠-٩) / Persian (۰-۹) digits**.
- **Migration** `20260821145633_add_core_domain` applied to dev + test + Neon.
- **Schema smoke test** — `tests/schema.test.ts` round-trips all four core
  models via the test DB.

### Task 3b — Content schema + full seed

- **Prisma models**: `Setting` (key, JSONB value), **`ScheduleException`**
  (closure dates: full/partial day, per-locale reason, optional per-service,
  `createdById`), `Testimonial`, `FaqItem`, `GalleryItem` (JSON per-locale +
  a stable unique `key` handle for idempotent seeding and future CRUD).
- **Migration** `20260821145800_add_content_schema` applied to dev + test + Neon.
- **Full seed** (`prisma/seed.ts`) from the live clinicorthocare.com content:
  - 1 admin user — password from `ADMIN_INITIAL_PASSWORD` env, argon2, 12-char
    minimum, `mustChangePassword: true`, and the upsert uses `update: {}` so
    re-seeding never clobbers a rotated password.
  - **11 services** (consultation, contrôle, urgence, détartrage, blanchiment,
    couronnes/bridges, soins radiculaires, implants, orthodontie brackets,
    PITTS protocol, aligneurs) with durations, in FR/AR/EN.
  - 1 patient, **5 testimonials**, **5 FAQs** — all genuinely translated.
  - **Settings**: `workingHours` (Sat–Thu 10:00–17:00, Fri closed),
    `bookingPolicy` (`pendingExpiryHours` 24, `minLeadTimeMinutes` 120,
    `maxHorizonDays` 90, `clinicTimezone` Africa/Algiers), `slotConfig`
    (granularity, buffer, **`lunchBreak`** key), `consentVersion`.
  - **ScheduleException** — one example holiday (New Year), bounded to the
    **clinic-local day** (UTC+1) rather than raw UTC midnight, avoiding the
    documented silent one-hour drift.
- **Content smoke test** extended (`tests/schema.test.ts`) — round-trips all
  five content models, including the closure→creator relation and per-locale
  JSON fields.

## Early security hardening (from the security review, delivered early)

- `src/lib/security/clientIp.ts` — `getClientIp()` reads trusted proxy headers
  (`x-real-ip` / `x-vercel-forwarded-for`) only; never trusts raw
  `x-forwarded-for` by default. 7 unit tests cover forged-header cases. Every
  per-IP rate-limit caller (Tasks 6, 12) must use it.
- `src/lib/security/headers.ts` + `next.config.ts` — global `SECURITY_HEADERS`
  (CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy`,
  `X-Content-Type-Options`, `Permissions-Policy`) and `NO_REFERRER_HEADERS`
  (`Referrer-Policy: no-referrer` + `frame-ancestors 'none'`) on the
  self-service token path.
- `src/i18n/request.ts` — locale validated unconditionally against the
  allow-list before being interpolated into the filesystem import path.
- `src/app/api/cron/cleanup/route.ts` — idempotent prune of expired rate-limit
  rows, authenticated with the `x-cron-secret` header (`401` without/with wrong
  secret). Same auth convention for Task 9's cron routes.

## Verification

- `npm run lint` — pass
- `npm run typecheck` — pass
- `npm test` — **30/30 pass** (phone 10, localized 6, rate-limit 6, schema 2,
  client-IP 6) against the test DB
- `npm run build` — pass; `/fr`, `/ar`, `/en` static + `/api/cron/cleanup`
- Migrations + seed applied to **local dev, local test, and Neon**
  (`prisma migrate deploy` + `prisma db seed`).
- Seeded per-locale data queried back in FR + AR; ScheduleException verified as
  the local day in UTC (`23:00Z` → `22:59:59Z`); cleanup cron prunes expired
  rows and keeps recent ones.
- Runtime header checks (production server): global security headers present on
  `/fr`; `no-referrer` + `frame-ancestors 'none'` on the token path.

## Notes

- Schema documents the `Setting` value shapes (working hours, booking policy,
  `slotConfig.lunchBreak`) in `tasks/plan.md` → Domain/Data Model.
- `GalleryItem` is seeded empty (schema only) — real before/after photos must
  come from the clinic before Task 11/21.
- **Still open (operator / future tasks):**
  - Rotate the Neon `DATABASE_URL` password — the live connection string was
    echoed in debug output during this session (see `tasks/todo.md`).
  - Task 10 must extend the CSP in `headers.ts` with the Google embed domains
    before mounting Reviews/Maps.
  - Number of chairs must be confirmed with the clinic before Task 4's
    single-resource assumption is safe (Task 3a-5 checkpoint).
- Not committed/pushed (pending the user's go-ahead).
