# Full-Project Hardening Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every blocker/major finding from the 5-audit wave (security, code, tests, admin UI/UX, performance) across the whole Ortho'Care codebase, verified by tests + build + browser.

**Architecture:** Fix at the source in dependency order (data/schema → domain libs → routes → UI), one slice per commit, full `npm test` + typecheck + lint + build gates before each commit. DB changes go through Prisma migrations against the local dev DB.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + Postgres, Vitest, Tailwind 4, next-intl (fr/ar/en).

**Spec:** The five audit reports in the parent conversation (2026-09-03 wave). Key source-of-truth files: `tasks/plan.md` (timezone = Africa/Algiers via `lib/time/clinicTime.ts` ONLY; audit via `logAction`; Zod shared schemas), `tasks/todo.md` (Definition of Done).

## Global Constraints

- Clinic-local time ONLY through `src/lib/time/clinicTime.ts` — never hardcode `"Africa/Algiers"` elsewhere.
- Every staff/patient/system state change calls `logAction()`; audit failures must never turn committed writes into 500s (use the `runSideEffect` catch-and-Sentry pattern).
- `fr` is default locale; admin dashboard is FR-only with `dir="ltr"`.
- Teal-600 + zinc palette; no purple; `focus-visible:ring-teal-600` on all interactives.
- No `window.confirm` anywhere — inline two-step confirm pattern (`WaitlistList.tsx:211-252`, `PatientDocuments.tsx:313-351`).
- Synthetic test data only; never paste `DATABASE_URL` into logs.
- Each task ends green: `npm run typecheck`, `npm run lint`, focused `npm test`, then commit (minimal human message).

---

## Phase 0 — Schema migration (blocks perf + waitlist fixes)

### Task 1: Appointment + AuditLog indexes

**Files:**
- Modify: `prisma/schema.prisma` (Appointment: `@@index([startTime])`, `@@index([status, createdAt])`, `@@index([startTime, endTime])`; AuditLog: `@@index([action, createdAt])`, `@@index([userId, createdAt])`)
- Create: `prisma/migrations/<ts>_add_hot_path_indexes/migration.sql` via `npx prisma migrate dev`

**Interfaces:**
- Consumes: nothing. Produces: indexes used by slot engine, call queue, expiry cron, KPIs, exports, audit viewer (no code change needed).

- [ ] Step 1: Add the five `@@index` lines to schema.prisma
- [ ] Step 2: Run `npx prisma migrate dev --name add_hot_path_indexes` (local dev DB)
- [ ] Step 3: Run `npm run typecheck && npm test -- tests/schema` (or full quick subset)
- [ ] Step 4: Commit — `git add prisma/ && git commit -m "index hot appointment and audit queries"`

---

## Phase 1 — P0 correctness + security (go-live blockers)

### Task 2: Enforce `whatsappOptIn` in the send path

**Files:**
- Modify: `src/lib/messaging/index.ts` (dispatcher gate), `src/lib/messaging/hybrid.ts` (fallback to SMS when `whatsappOptIn === false`)
- Test: extend messaging/hybrid tests

**Interfaces:**
- Consumes: `Patient.whatsappOptIn`, `Patient.messagingOptOut`. Produces: provider selection that never sends WhatsApp without documented opt-in.

- [ ] Step 1: Write failing test — patient with `whatsappOptIn=false`, provider `whatsapp-first` → records provider `twilio`/SMS path
- [ ] Step 2: Implement gate in dispatcher + hybrid fallback
- [ ] Step 3: Run `npm test -- src/lib/messaging`
- [ ] Step 4: Commit — `git commit -m "respect whatsapp opt-in on send"`

### Task 3: Await waitlist subscriber (kill fire-and-forget)

**Files:**
- Modify: `src/lib/booking/events.ts`, `src/lib/booking/releaseSlot.ts`, `src/lib/booking/rescheduleSlot.ts` (or wherever `emitSlotFreed` is called), `src/lib/selfservice/actions.ts`
- Rule: await the subscriber with a bounded timeout (e.g. `Promise.race` 8s); failures go to Sentry via `runSideEffect`, never throw to the caller.

- [ ] Step 1: Write failing test — releaseSlot resolves only after waitlist SMS row exists (use existing waitlist integration suite shape)
- [ ] Step 2: Implement await-with-timeout in all three call paths
- [ ] Step 3: Run `npm test -- waitlist` + booking suites
- [ ] Step 4: Commit — `git commit -m "await waitlist notify on slot freed"`

### Task 4: No-show cron grace period + conditional waitlist consume

**Files:**
- Modify: `src/lib/cron/noShow.ts` (only mark appointments whose clinic day fully passed, e.g. `endTime < now - 12h`), `src/lib/waitlist/notifyWaitlist.ts` (conditional `updateMany({ where: { id, active: true } })`, skip when matched 0)

- [ ] Step 1: Failing tests — same-day 10:00 CONFIRMED appt NOT marked at 18:00 run; two concurrent frees → exactly one SMS
- [ ] Step 2: Implement both
- [ ] Step 3: Run `npm test -- cron waitlist`
- [ ] Step 4: Commit — `git commit -m "guard no-show window and waitlist consume"`

### Task 5: Public CSRF guard fails closed in production

**Files:**
- Modify: `src/lib/security/origin.ts` — when `NODE_ENV=production` and `APP_URL` unset, fall back to Host-match (reuse strict logic); add unit tests for unset/mismatch/Referer paths.

- [ ] Step 1: Failing unit test (`origin.test.ts`)
- [ ] Step 2: Implement
- [ ] Step 3: Run `npm test -- src/lib/security`
- [ ] Step 4: Commit — `git commit -m "close csrf guard when app url missing"`

### Task 6: Production CSP without `unsafe-eval`

**Files:**
- Modify: `src/lib/security/headers.ts` — emit `script-src 'self' 'unsafe-inline'` (drop `unsafe-eval`) when `NODE_ENV=production`; keep dev policy as-is. Update `headers.test.ts`.

- [ ] Step 1: Failing test — production CSP has no `unsafe-eval`, token page still has no Google frame-src
- [ ] Step 2: Implement env split
- [ ] Step 3: Run `npm test -- headers && npm run build`
- [ ] Step 4: Commit — `git commit -m "tighten production csp"`

---

## Phase 2 — Robustness (P1)

### Task 7: Post-commit audit + reschedule recovery never 500

**Files:**
- Modify: `src/app/api/admin/appointments/[id]/route.ts`, `[id]/reschedule/route.ts`, `closures/[id]/resolve/route.ts`, `src/lib/selfservice/actions.ts` (reschedule block returns new appointment/token on 200; audit wrapped in try/catch→Sentry), `sms/single/route.ts`
- Pattern: `try { await logAction(...) } catch (e) { captureException(scrubbed) }`

- [ ] Step 1: Implement wrappers (no behavior change on happy path)
- [ ] Step 2: Run full `npm test`
- [ ] Step 3: Commit — `git commit -m "keep post-commit audit out of responses"`

### Task 8: Broadcast + cron loops bounded

**Files:**
- Modify: `src/lib/messaging/smsCenter.ts` (chunk fan-out, persist progress per chunk on the batch row so retry resumes), `src/lib/cron/*.ts` (bound loops, document budget in code comment)
- Keep the idempotency-key semantics; a retried partial batch resumes, never restarts.

- [ ] Step 1: Failing test — simulated mid-loop kill → retry sends only the remainder
- [ ] Step 2: Implement chunking + resume
- [ ] Step 3: Run `npm test -- sms-center cron`
- [ ] Step 4: Commit — `git commit -m "make broadcasts resumable"`

### Task 9: Small correctness batch

**Files:**
- `src/lib/booking/loadSlotContext.ts` — `Promise.all` the 3 settings reads (then `unstable_cache` tag `settings` if the settings-write route can invalidate; else Promise.all only)
- `src/app/api/slots/route.ts` — replace interactive `$transaction` reads with `Promise.all`
- `src/app/api/admin/closures/route.ts` — upcoming-window filter + `take`
- `src/app/api/admin/appointments/pending/route.ts` — `take: 200`
- `src/components/public/BookingWizard/BookingWizard.tsx` — key slot cache by `serviceId:date`, discard stale-service writes
- `src/lib/booking/releaseSlot.ts` — move `subscribeWaitlist()` to explicit init (or document why import-side-effect is safe)

- [ ] Step 1: Implement each (tests exist; keep them green)
- [ ] Step 2: Run `npm test -- booking slots closures`
- [ ] Step 3: Commit — `git commit -m "tighten slot reads and caches"`

### Task 10: Security hygiene batch

**Files:**
- New: `src/lib/monitoring/safeLog.ts` (PII-safe logger: label + error class only) — replace `console.error(e)` in `api/appointments/route.ts:145`, `runSideEffect.ts:12`, `selfservice/actions.ts:178`, `notifyWaitlist.ts`, `claimWaitlist.ts`; wire messaging failures to Sentry `message_send_failed`
- `src/lib/security/clientIp.ts` — document proxy-overwrite invariant (+ runtime warn if `x-real-ip` present but deployment isn't Vercel? comment at minimum)
- New: `src/app/global-error.tsx` — generic message + `Sentry.captureException`
- `prisma/seed.ts` — reject weak `ADMIN_INITIAL_PASSWORD` via existing password policy
- `runSideEffect.ts` — report to Sentry monitoring pattern

- [ ] Step 1: Implement + unit test safeLog
- [ ] Step 2: Run focused tests + build
- [ ] Step 3: Commit — `git commit -m "harden error logging paths"`

---

## Phase 3 — Admin UI/UX (frontend focus)

### Task 11: Confirm-pattern migration (no `window.confirm`)

**Files:**
- Modify: `ClosuresDashboard.tsx`, `ServicesTab.tsx`, `FaqsTab.tsx`, `TestimonialsTab.tsx`, `GalleryTab.tsx`, `TeamDashboard.tsx` (role select)
- Pattern to copy: `WaitlistList.tsx:211-252` (inline two-step + focus move)

- [ ] Step 1: Migrate closures bulk-cancel first (highest impact), browser-check keyboard flow
- [ ] Step 2: Migrate the 4 content tabs + team role select
- [ ] Step 3: `npm test` (component suites) + browser spot-check
- [ ] Step 4: Commit — `git commit -m "replace confirm dialogs with inline steps"`

### Task 12: Data-correctness UI batch

**Files:**
- `AppointmentCallQueue.tsx` — show slot DATE + time; add `tel:` links; "Actualisé à HH:mm" + refetch on visibilitychange
- `AppointmentDayView.tsx` — `tel:` links; skeleton loading; "Revenir à aujourd'hui" empty state
- `AuditViewer.tsx` — clinic-local timestamps; null guards (`entityId`, details); expand truncated details
- Replace hardcoded `"Africa/Algiers"` with clinicTime helpers in `ExportsDashboard`, `TeamDashboard`, `ClosuresDashboard`
- `ExportsDashboard` — clinic-local default date + print footer
- KpiCards "En attente d'appel" → link to queue tab (`?tab=queue` support in AppointmentsDashboard)

- [ ] Step 1: Implement
- [ ] Step 2: Browser-check day view + queue + audit (desktop + phone widths)
- [ ] Step 3: Commit — `git commit -m "fix admin date display and call queue"`

### Task 13: Nav + a11y batch

**Files:**
- `(dashboard)/layout.tsx` — skip-to-content link targeting `#main-content`
- `Sidebar.tsx` + `MobileNav.tsx` — `usePathname` active state + `aria-current="page"`; focus trap in drawer (or `inert` background); fix stray `}, [open ]);`
- `SettingsDashboard.tsx` — focus rings on day buttons
- Content tabs + appointments/sms tabs — one WAI-ARIA pattern (`tablist`/`tabpanel`/`aria-controls`; arrow keys)
- `role="status"` → `role="alert"` for error text in ManualSmsForm/WaitlistForm/ManualBookingForm
- Heading levels (PatientDetail h3→h2, ContentDashboard card titles)
- `AppointmentStatusBadge` purple → sky/teal-family

- [ ] Step 1: Implement
- [ ] Step 2: Keyboard-only pass through dashboard in browser
- [ ] Step 3: Commit — `git commit -m "polish admin nav and focus states"`

### Task 14: Component consolidation + feedback

**Files:**
- New: `src/components/admin/PatientPicker.tsx` — extract from ManualBookingForm/ManualSmsForm/WaitlistForm (unify `firstName lastName` order)
- Content tabs — unify on ServicesTab notice + error-with-retry state machine
- Closures list — real error state + retry
- `BroadcastForm` — truncate batchId to 8 chars; disable submit while pending
- Success-banner focus — unify (focus for consequential feedback)
- Cross-tab staleness — child actions notify shell (extend `bumpReload` pattern)

- [ ] Step 1: Extract PatientPicker, migrate 3 forms, keep tests green
- [ ] Step 2: Unify notices/error states
- [ ] Step 3: Component tests for ManualBookingForm + AppointmentSearch key paths
- [ ] Step 4: Commit — `git commit -m "unify admin pickers and notices"`

---

## Phase 4 — Performance

### Task 15: Homepage weight (5.6MB game images + hero LCP)

**Files:**
- Compress `/images/beforewhitening.jpeg`, `/images/afterwhitening.jpeg` to ≤150KB WebP sized to the 640×400 canvas (add `sharp` devDependency + `scripts/optimize-images.ts` if no system converter exists)
- `ToothBrushGameClient.tsx` — load images only when section nears viewport (IntersectionObserver); pause rAF loop off-screen and after win
- `HeroHome.tsx` — hero copy as plain server HTML/CSS entrance (no `opacity: 0` initial on the h1); framer-motion only for decorative floaters
- `CursorGlow.tsx` — replace runtime `blur-[100px]` + `mix-blend-multiply` with pre-baked radial-gradient (or gate to pointer:fine with smaller budget)

- [ ] Step 1: Optimize assets, wire lazy load + rAF gating
- [ ] Step 2: Hero LCP fix, browser-verify (performance trace: LCP element, CLS)
- [ ] Step 3: Commit — `git commit -m "slim homepage weight and hero lcp"`

### Task 16: framer-motion removal from content pages + Marquee CSS

**Files:**
- Rewrite `Reveal.tsx` internals with IntersectionObserver + CSS (keep props API so call sites don't change)
- `FloatCard` hover → CSS transitions; `Marquee` → CSS `@keyframes` + `animation-play-state` pause (keep pause-on-hover/focus behavior)
- Remove framer-motion imports from content pages; keep dep only if game/cursor still need it

- [ ] Step 1: Rewrite + keep all component tests green
- [ ] Step 2: Browser-check home/services/faq/gallery (animations + reduced-motion)
- [ ] Step 3: Commit — `git commit -m "move reveal and marquee to css"`

### Task 17: Data-layer + font batch

**Files:**
- `src/lib/public/services.ts` — `unstable_cache` + `services` tag; invalidate from admin service routes (mirror content.ts pattern)
- `services/[slug]/page.tsx` — single fetch (cache makes double-query moot; still dedupe if trivial)
- `[locale]/layout.tsx` — `arabic` font only when `locale === "ar"`; move `Geist_Mono` to book + admin layout
- `src/lib/exports/appointments.ts` — dynamic `import("xlsx")` inside `toXLSX`
- Gallery — `images.remotePatterns` for blob host + `next/image` with `sizes` (keep lazy)
- KPIs — `unstable_cache` 60s for long ranges (document SQL-groupBy follow-up, skip for now)

- [ ] Step 1: Implement
- [ ] Step 2: Tests + build + browser spot-check (fonts, gallery)
- [ ] Step 3: Commit — `git commit -m "cache services and trim fonts"`

---

## Phase 5 — Test backfill (from test audit)

### Task 18: Critical test gaps

**Files:**
- New: `src/lib/closures/window.test.ts` (overlap matrix)
- Extend: `tests/integration/patient-anonymize.test.ts` (SMS scrub, notification payload, audit preserved, treatment cleared, docs 404, concurrent race)
- New: `src/lib/team/select.test.ts` (passwordHash exclusion + route body allowlist)

### Task 19: High-value route tests (time-boxed)

**Files:**
- 429 spot tests: `sms/broadcast`, `waitlist POST`, `exports/appointments`, `team POST`
- CSRF spot tests: waitlist/sms/team/closures/appointments PATCH families
- Stale sessions at route level: expired absolute/idle/revoked/tampered/mustChangePassword
- Broadcast double-submit → one batch + one audit
- `policy.test.ts` + `clinicInfo.test.ts` defaults; `public/services` tests; `origin`/`cronAuth` units; `buildBlobKey` units

### Task 20: Flake hardening (time-boxed)

**Files:**
- `waitlist.test.ts` sleeps → `waitFor` polling
- New: `tests/integration/helpers/testDates.ts` frozen-clock helper; apply to kpis + exports suites + one midnight-rollover case

- [ ] Steps per task: write test → see it fail (or prove gap) → implement → green → commit (`git commit -m "cover closure and erasure edges"` etc.)

---

## Phase 6 — Global security test + closeout

### Task 21: Global security verification loop

- [ ] Step 1: Run FULL `npm test` + typecheck + lint + build
- [ ] Step 2: Re-run security-auditor subagent on the diff since this loop started; fix every new finding
- [ ] Step 3: Browser pass — login/lockout, RBAC nav gating (receptionist vs admin), token page headers, rate-limit 429 on booking flood (dev), CSP headers on /fr + token page
- [ ] Step 4: Update `tasks/todo.md` + write `tasks/full-hardening-summary.md`
- [ ] Step 5: Final commit — `git commit -m "close full hardening loop"`

## Self-Review

- [x] Spec coverage: every Critical/High audit item maps to a task (whatsappOptIn→T2, fire-and-forget→T3, no-show→T4, CSRF fail-open→T5, CSP→T6, indexes→T1, double-notify→T4, reschedule recovery→T7, broadcast budget→T8, cache race→T9, confirm dialogs→T11, queue date→T12, images/LCP→T15, motion→T16).
- [x] Placeholder scan: no TBDs; each task names files + verification + commit.
- [x] Type consistency: helper/prop names reference existing repo patterns (runSideEffect, clinicTime, WaitlistList confirm).
