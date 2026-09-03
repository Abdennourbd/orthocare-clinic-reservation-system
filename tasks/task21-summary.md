# Task 21 — Content management + settings

**Status:** ✅ Complete (planned by plan-agent, reviewed by code-reviewer + security-auditor + test-engineer, review findings fixed, verified end-to-end in browser)

**Delivery timeline:** Schemas + rate limits → admin APIs (services, testimonials, FAQs, gallery, settings, closures + resolve) → admin UI (content/settings/closures + Sidebar) → authz-matrix (22 rows) + integration tests → 3-subagent review loop (1 REQUEST-CHANGES round, all Important fixed) → browser verification. Commits: `add content settings schemas`, `add admin content apis`, `add content settings ui`, `cover content apis with tests`, `tidy test lint`, `fix review findings`.

## What was delivered

### Foundation (Slice 0)
- **`src/schemas/services.ts`** — slug (lowercase/digits/dashes), localized name/description (FR required, AR/EN optional), duration 5–480 min, price nullable, currency; PATCH = partial + "no-op" refine.
- **`src/schemas/content.ts`** — testimonial/FAQ/gallery schemas (key rule, rating 1–5, gallery `imageUrl` allowlisted to `/…` or `http(s)://` after review).
- **`src/schemas/settings.ts`** — workingHours (per-day open/close with close>open, ≥1 open day), slotConfig (granularity 5–120 multiple-of-5, buffer 0–60, lunchBreak HH:MM), bookingPolicy (expiry 1–72h, lead 0–10080m, horizon 1–365d, timezone literal), messageTemplates (9 keys, non-empty, partial merge), clinicInfo passthrough. Ranges mirror the engine's `SlotConfigError` boundaries so an admin typo can never crash slot generation.
- **`src/schemas/closures.ts`** — clinic-local dates, allDay vs partial (start/end required + ordered), localized reason, optional serviceId; resolve schema (`cancel_and_notify`|`keep_for_call`, ≤200 ids, explicit `acknowledgedUnresolved`).
- **`src/lib/content/rateLimits.ts`** — staff-keyed read (60/5min) / write (30/5min) pools for content, settings, closures.

### APIs (Slices 1–4, all ADMIN-only, guard→CSRF→rate-limit→Zod→DB, named selects, ids-only audit)
- **Services** (`GET/POST /api/admin/services`, `PATCH/DELETE /[id]`): 201/409 `SLUG_TAKEN` (P2002 arbiter), PATCH slug-clash 409, DELETE refused with 409 `SERVICE_IN_USE` whenever **any** appointment references the service (required-FK `ON DELETE RESTRICT`; P2003 race mapped to the same 409). Duration edits take effect on the next engine call (`loadSlotContext` reads the row live).
- **Testimonials / FAQs / Gallery** (GET/POST + PATCH/DELETE `[id]` each): ordered by `key asc` (public editorial order), 409 `KEY_TAKEN`, hard delete (no FKs), every write calls `revalidateTag(tag, "max")` so Task 11 public pages reflect edits within the prod TTL.
- **Settings** (`GET/PATCH /api/admin/settings`): GET returns the editable bundle (templates merged over built-ins so the dashboard shows effective text); PATCH is single-key (`{key, value}`) with templates merged, never wiped. Audited as `SETTINGS_UPDATED` with key only.
- **Closures** (`GET/POST /api/admin/closures`, `DELETE /[id]`, `POST /[id]/resolve`): two-phase by design — POST creates (blocks new bookings immediately, engine reads exceptions live) and returns the overlapping PENDING/CONFIRMED appointments **without touching them**; `/resolve` executes the staff decision. Partial-day closures narrow by the HH:MM window in TypeScript via shared `src/lib/closures/window.ts` (same math as the engine — a 13:00–14:00 closure lists only that window). `cancel_and_notify` runs `releaseSlot(CLOSURE)` + cancelled SMS per id (waitlist fires, per-id ok/fail, out-of-scope ids rejected as `OUT_OF_SCOPE`, per-appointment audit only on success); `keep_for_call` leaves appointments for phone reschedule. Subset resolve without `acknowledgedUnresolved` → 409 `UNRESOLVED_REMAINING`.
- **`src/lib/closures/window.ts`** — pure `appointmentOverlapsClosure()` shared by create + resolve so preview and execution can never disagree.

### Admin UI (Slice 5, FR-only, TeamDashboard visual language)
- **Sidebar** — Contenu / Fermetures / Réglages added, ADMIN-gated by the existing filter.
- **`/admin/content`** — tabbed CRUD (Services, Témoignages, FAQ, Galerie): create forms with FR plain-language labels ("Durée (minutes)"), show/hide toggles, guarded deletes, loading/empty/error states, keyboard-accessible tabs.
- **`/admin/settings`** — 5 independently-saving sections (horaires with per-day open/close/fermé, créneaux + pause déjeuner, règles de réservation, 9 modèles SMS with placeholder hints, infos clinique). Empty template fields mean "leave unchanged".
- **`/admin/closures`** — create form (dates, full/partial day, motif, optional service scope from live API) → affected list → two-button decision (bulk cancel-and-notify with confirm, keep-for-call). Sends `acknowledgedUnresolved: false` first and surfaces the 409 as an explicit "continuer quand même ?" confirm.
- All three pages server-guard ADMIN (receptionist → `/admin` redirect, verified live).

### Tests (Slice 6)
- **`tests/authz-matrix.test.ts`** — 22 new rows (every method×path), all `allowed: [ADMIN]`, real-export handler references; matrix now 235 tests green including the filesystem-coverage + handler-identity invariants.
- **`tests/integration/content-settings.test.ts`** — 15 tests: services CRUD + slug-clash 409 + duration 0 → 400 + in-use DELETE 409 + deactivation + unused DELETE; content CRUD ×3 + dup keys + gallery URL 400 + clinicInfo; settings bundle + invalid slotConfig/policy/template 400s (row unchanged) + template merge + receptionist 403; closures affected-exact + partial-window narrowing + unresolved 409 → ack escape → succeeded/unresolved shape + OUT_OF_SCOPE refusal + keep_for_call untouched + cancel SMS row + `CLOSURE_CREATED` audit.

## Review loop (code-reviewer + security-auditor + test-engineer)

| Round | Findings | Resolution |
|---|---|---|
| code-reviewer | REQUEST-CHANGES: partial-day affected overcount; audit-on-failed-resolve; UI bypassed 409 guard; gallery URL no allowlist; resolve Zod-after-lookup; copy mismatch; empty-template UX | All fixed (`window.ts` narrowing, audit-inside-try, two-step UI confirm, URL refine, Zod-first + matrix row to 400, copy fix, empty-filter) + 5 new regression tests |
| security-auditor | APPROVE (2 LOW: gallery scheme — fixed; resolve out-of-scope — fixed with OUT_OF_SCOPE; 4 INFO triaged: P2003→409 done, rest accepted) | Fixed where cheap, rest recorded |
| test-engineer | APPROVE-with-gaps (10/10 then; gaps: PATCH clash, unresolved 409, gallery URL, clinicInfo, partial/out-of-scope) | All listed gaps added as tests (15/15) |

## Verification (2026-09-03)
```
npm test          → 73 files, 964/964 green
npm run typecheck → OK
npm run lint      → OK (0 errors, 0 warnings)
npm run build     → OK
```
Browser (dev server, admin account, zero console errors/warnings):
- `/admin/content` — 11 seeded services listed, tabs switch (gallery images load), create form renders
- `/admin/settings` — all 5 sections with live DB values (hours, 15/5, 24/120/90, 9 templates, clinic info)
- `/admin/closures` — form + live service dropdown + seeded closures listed; live create (2027-06-01 → 201, correct UTC bounds, affected []) + delete (200), dev DB left clean
- `/fr/services` — renders live service data (durations + prices), proving admin→public loop
- Receptionist (fresh account via Team API): sidebar hides Contenu/Fermetures/Réglages/Exports/Équipe/Journal; direct `/admin/content` → redirected to `/admin`; account deactivated after (audited)
- Mobile 375px: pages stack; the dashboard shell's fixed sidebar overflow is pre-existing (Task 12 shell, all admin pages share it), not introduced here

## Decisions / rulings
1. **Service DELETE blocked on ANY referencing appointment** (not just active) — required by the FK; deactivation is the supported path.
2. **Settings PATCH is single-key + templates merge** — a partial template edit can never wipe the other 8.
3. **Resolve is Zod-first** like every sibling (matrix row updated to 400).
4. **Gallery is URL-paste only in v1** (no upload flow); scheme allowlisted.
5. **`revalidateTag(tag, "max")`** — Next 16 requires the second arg; tests stub `next/cache` (same pattern as `public-content.test.ts`).
6. **Content CRUD audited as `SETTINGS_UPDATED`** (enum has no dedicated content actions) with key-only detail.

## Deferred (non-blocking, recorded)
- GET lists have no pagination (fine at admin scale; add `take` cap if gallery/testimonials grow).
- `currency` allowlist (`DZD`) and `clinicInfo.phone` format check (low risk, admin-only).
- Downstream-effect proofs live at code-path level (engine/cron read rows live; Task 4 engine tests cover exception subtraction) — full duration-change→slot-grid and template→SMS-render round-trips remain engine/messaging-suite scope.
- Multi-day partial closures apply the HH:MM window per day (engine semantics) — documented in `window.ts`.
