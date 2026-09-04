# Full-Project Hardening Loop — Summary

Date: 2026-09-04. Plan: `docs/superpowers/plans/2026-09-03-full-project-hardening.md`.
Method: 5 parallel audit subagents (security, code, tests, admin UI/UX, performance) →
written plan → phased execution with per-slice commits → adversarial re-audit →
fixes → full verification → push.

## Wave 1 audits (read-only, no code changed)
- **security-auditor**: 0 critical/high, 1 medium (CSP unsafe-eval), 3 low, 2 info.
- **code-reviewer**: 2 blockers (`whatsappOptIn` never enforced; fire-and-forget
  waitlist notify dropped on serverless) + 8 important suggestions.
- **test-engineer**: authz-matrix COMPLETE (zero gaps); gaps in rate-limit paths,
  CSRF breadth, session-at-route-level, anonymize fan-out, idempotency races.
- **admin UI/UX**: 2 blockers (`window.confirm` everywhere; call queue missing the
  date) + 13 major + 12 minor.
- **web-performance-auditor**: 2 critical (missing Appointment indexes; 5.6 MB
  homepage game images), 2 high (hero LCP hidden until hydration; framer-motion
  on every page), 7 medium, 5 low.

## What was fixed (17 commits)
- **Schema**: `Appointment(startTime / status+createdAt / startTime+endTime)` +
  `AuditLog(action+createdAt / userId+createdAt)` indexes + migration.
- **Correctness blockers**: `whatsappOptIn` enforced in dispatcher (fallback to
  SMS, explicit-true only) + tests; `emitSlotFreedAsync` awaited with 15s bound
  in all 3 emit paths; claim-FIRST waitlist consume (conditional `updateMany`) +
  claim restore on send-throw; no-show 12h grace; booking wizard slot cache
  keyed by `serviceId:date`.
- **Security**: public CSRF guard fail-closed in production (+ unit tests);
  production CSP drops `unsafe-eval` (+ tests); `logActionSafe` everywhere (42
  call sites — committed writes never 500); `reportError` PII-safe reporter
  adopted on all side-effect paths + blob adapter; seed rejects weak admin
  passwords; `global-error.tsx`; proxy-header trust documented; loopback CSRF
  exemption gated on non-production.
- **Robustness**: broadcast resume (first positional, then per-recipient by
  sent phones — survives audience shifts); `safeRevalidateTag` on all 12
  content write sites; slot reads off interactive transactions; closures list
  bounded; call queue `take: 200`.
- **Admin UI/UX**: shared `ConfirmPanel` (closures bulk-cancel with 409-continue
  step, row deletes, 4 content tabs, team role change staged); call queue shows
  slot DATE + `tel:` links + "Actualisé à" + refetch on focus; audit viewer
  clinic-local timestamps + null guards + expandable details; all hardcoded
  `"Africa/Algiers"` routed through `clinicTime`; exports clinic-local dates;
  KPI cards link to queue (`?tab=queue`); skip link; active nav state;
  MobileNav focus trap + labelled dialog; settings focus rings; `role=alert`
  for errors; heading levels; badge purple→sky; content tablist keyboard
  pattern; toggle mutation notices; closures real error state; broadcast
  batchId truncated; shared `PatientPicker` (3 forms unified); cross-tab
  refresh via `notifyShell`; mobile menu, pausable marquee, focus rings,
  ServicesPreview empty fix.
- **Performance**: game images 5.6 MB → 40 KB WebP + viewport-gated load + rAF
  pause off-screen/after-win; hero copy as CSS entrance (LCP paints with SSR);
  CursorGlow pre-baked gradient; Reveal/FloatCard/Marquee/FaqAccordion moved
  off framer-motion to CSS+IntersectionObserver; Arabic font only on `ar`;
  mono font moved to admin layout; services `unstable_cache` + tag
  invalidation; XLSX dynamic import; gallery `next/image` + remotePatterns;
  KPI 60s cache. **Caches are production-only** (`NODE_ENV === "production"`) —
  the real `unstable_cache` keeps an in-process cache that polluted suites.
- **Tests** (~60 new): closures window matrix, team select allowlist, booking
  policy + consent + clinicInfo defaults (caught a real `??`-vs-type bug,
  fixed in source), cronAuth, blobKey traversal, public services, origin +
  headers CSP-split units, guard-rails (4× 429 spots, 5× CSRF families, 2×
  stale sessions), anonymize fan-out (SMS scrub, treatment cleared, docs,
  waitlist, audit preserved, concurrent 200+409), ManualBookingForm,
  AppointmentSearch, LoginForm, ConfirmPanel, PatientPicker consumers updated,
  waitlist sleeps removed (awaited emit is deterministic), broadcast resume
  per-recipient assertions.

## Verification
- Full suite green, typecheck + lint + `next build` clean (final numbers in
  the closing commit message / CI).
- Browser: public SEO spot-checks, mobile menu, booking wizard, admin queue/
  day/search, closures confirm flow (dev server).
- Re-audit after fixes: 0 critical/high; all medium/low/info addressed except
  two accepted notes below.

## Accepted / deferred (documented, not lost)
- KPI cache has no tag invalidation (60s staleness by design).
- Broadcast `alreadySent` double-click semantics unchanged; per-recipient
  resume only kicks in on incomplete batches.
- `xlsx@0.18.5` is the unmaintained channel (noted at the lazy-import site).
- Patient search stays leading-wildcard (standing pg_trgm ruling).
- KPI long-range SQL groupBy, `use cache`/`cacheTag` migration, pg pool `max`
  sizing, Speculation Rules for `/book` — future performance follow-ups.
- Uptime provider choice, restore-drill live run, Sentry live scrub check,
  prod env + deploy — operator steps (see Task 23 summary).
