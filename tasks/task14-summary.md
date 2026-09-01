# Task 14 — Appointment Management (Admin Core)

**Status:** ✅ Complete (6 steps, reviewed by code-reviewer + security-auditor + test-engineer in a loop until clean)

**Delivery timeline:** Steps 1–2 (schemas + domain module + routes) and Step 3 (authz matrix) Sept 1; Step 4 (integration tests) Sept 1; Step 5 (admin UI) + browser smoke test Sept 1; final whole-branch review + fix wave Sept 1.

## What was delivered

### Backend (Steps 1–2)
- **`src/schemas/appointment.ts`** — Zod schemas shared route/form: `appointmentListQuerySchema` (date, status), `manualBookingSchema`, `appointmentStatusChangeSchema` (CONFIRM/CANCEL/COMPLETE/NO_SHOW), `appointmentRescheduleSchema`, `appointmentSearchQuerySchema`. FR validation messages.
- **`src/lib/booking/adminTransitions.ts`** — pure single source of truth mapping each staff action → `{newStatus, timestampField, auditAction, cancelReason, smsSender, releasesSlot, from[]}`. No DB/messaging imports (senders by stable name), so it is unit-testable without a database.
- **`src/lib/booking/rateLimits.ts`** — shared read (60/5min) and write (30/5min) budgets, session-userId-keyed.
- **`src/lib/booking/runSideEffect.ts`** — shared `runSideEffect` that swallows messaging failures so an SMS outage never fails a status change.
- **6 route handlers** in `src/app/api/admin/appointments/`:
  - `GET /api/admin/appointments?date=&status=` — day view (clinic-local day bounds), audited (scope day-view).
  - `POST /api/admin/appointments` — manual booking CONFIRMED via `bookSlot()` (blocks slot, availability re-checked under advisory lock); 404 unknown/inactive patient, 409 SLOT_CONFLICT, 400 RESOURCE_UNSUPPORTED; audits APPOINTMENT_CONFIRMED.
  - `GET /api/admin/appointments/[id]` — detail, audited (scope record).
  - `PATCH /api/admin/appointments/[id]` — status change through `STATUS_TRANSITIONS`; atomic `updateMany` with the `from` status predicate (TOCTOU-safe, mirrors `releaseSlotInTx`); CANCEL routes through `releaseSlot(STAFF)` so the waitlist fires; CONFIRM stamps `confirmedAt`+`confirmedByUserId` + sends confirmation SMS; idempotent-CONFIRM no-op audits `PATIENT_RECORD_VIEWED`.
  - `POST /api/admin/appointments/[id]/reschedule` — via `rescheduleSlot()` (old RESCHEDULED, new CONFIRMED, availability inherent), rotated-link SMS, audited.
  - `GET /api/admin/appointments/pending` — call queue: PENDING oldest-first with `expiresAt` + `msRemaining` (same policy value the expiry cron uses).
  - `GET /api/admin/appointments/search?q=` — phone/name in ONE search, LIKE-metachar safe (both protections from the patients route), `q` never enters audit detail.
- Every route: `requireStaff(roles)` → (CSRF on writes) → rate limit → Zod → domain checks (404/409) → write. Named-field selects/spreads only. Audit `detail` carries ids/enums/counters/instants only — never names, phones, or `q`.

### Tests (Steps 3–4)
- **`tests/authz-matrix.test.ts`** — 7 new rows (all appointment routes × {anonymous, receptionist, admin, deactivated}), by-reference handlers, coverage scan green.
- **`tests/integration/appointments-api.test.ts`** (16 tests) — day view, manual booking blocks slot + 409/404/400 paths, every status transition (timestamp + audit + SMS present/absent), illegal transitions 409, idempotent CONFIRM no double-SMS, reschedule (DB state + conflict + no partial state), call queue ordering + countdown, search by name/phone/partial digits/LIKE-meta + `q`-never-in-audit.
- **`src/lib/booking/adminTransitions.test.ts`** — pure map assertions incl. `from` sets and invariants.

### Admin UI (Step 5) — FR, production-quality
- `/admin/appointments` page (tabbed dashboard: Agenda / File d'attente / Recherche) + "Nouveau rendez-vous" inline form.
- Components: `AppointmentsDashboard`, `AppointmentDayView`, `AppointmentCallQueue` (expiry countdown), `AppointmentSearch`, `ManualBookingForm` (patient search → service → clinic-local slot → note → language), `AppointmentStatusBadge` (color+text, WCAG), `AppointmentActions` (context-aware: Confirmer/Terminé/Absent/Reporter/Annuler with two-step destructive confirm), `appointmentTypes` (shared row types + FR labels).
- Sidebar "Rendez-vous" nav item (both roles).
- `src/lib/time/clinicTime.ts` — added `clinicLocalToUTC` (clinic wall-clock → UTC, single timezone authority).

## Review loop (code-reviewer + security-auditor + test-engineer, until clean)

| Round | Reviewer | Findings | Resolution |
|---|---|---|---|
| 1 | code-reviewer | 1 Critical (TOCTOU direct-write), 2 Important, 5 Minor | Fix commit `8dd90db` |
| 1 | security-auditor | 1 Important (same TOCTOU), 5 Minor | Same fix commit |
| 2 | security-auditor (scoped re-review) | All 7 ADDRESSED, no new Critical/Important | ✅ |
| 3 | test-engineer | "Critical" shared-state claims → **false positives** (tests/setup.ts truncates per-test); real gaps: DB assertions for timestamps/cancelReason, reschedule DB state, search specificity/case-insensitivity/DZ phone | Fix commit `7f19b6e` |
| 4 | code-reviewer (final whole-branch) | **APPROVE — merge-ready**, no Critical/Important; 6 Minor | Fix wave `1c45579` (null→404, named-fields literal, dead ref) |
| 5 | code-reviewer (scoped re-review) | All 3 ADDRESSED, APPROVE | ✅ |

## Browser smoke test (local dev DB, seeded admin) — caught a real bug
- **Bug found:** `service.name` is per-locale JSON `{fr,ar,en}`; the day view rendered it raw → React "Objects are not valid as a child" runtime error. Fixed with `localized(service.name, "fr")` in all 3 list components + typed `name` as `Record<string,…>` (`51d716c`).
- Verified working: day view (localized services, status badges, context-aware actions), confirm action → CONFIRMATION SMS row + APPOINTMENT_CONFIRMED audit, call queue ("22 h 54 min restantes"), search by name across statuses, manual booking end-to-end (CONFIRMED + createdByUserId + visitNotes + audit, success banner).

## Verification (2026-09-01)
```
npm test          → 569/569 green (52 files), 0 failures
npm run typecheck → OK
npm run lint      → OK (0 errors, 0 warnings)
npm run build     → Compiled successfully, 53 static pages
```

## Decisions / rulings
1. **Manual booking does NOT stamp `confirmedAt`/`confirmedByUserId`** (audit + `source=MANUAL` + `createdByUserId` is the trail; final reviewer confirmed no KPI/cron reads `confirmedAt`). Audit `APPOINTMENT_CONFIRMED` (no dedicated creation action exists).
2. **`resourceId` rejected 400 RESOURCE_UNSUPPORTED** in both manual booking and reschedule — v2-reserved column, single-resource assumption in v1.
3. **CONFIRM `from` includes CONFIRMED** so the idempotent no-op passes the gate; the atomic `updateMany` predicate accepts CONFIRMED→CONFIRMED races (benign: same status). Narrowed duplicate-SMS race accepted (SMS senders idempotent).
4. **COMPLETE/NO_SHOW have no SMS** — no sender exists for them (plan §Notes).
5. **Search is GET with `q` in the URL** — documented API; `q` excluded from audit; access-log redaction is an ops concern, not code.
6. **Call queue includes MANUAL-source PENDING** — visibility, not expiry mechanics.

## Deferred (non-blocking, recorded)
- Concurrent identical CONFIRM/COMPLETE double-fire can duplicate an SMS/audit row in a millisecond window (state stays consistent; SMS senders idempotent).
- Manual-booking post-commit stamping + audit-after-commit not atomic (same pattern as the rest of the codebase).
- Patient-active TOCTOU between manual-booking gate and `bookSlot` (millisecond window, staff-adjacent harm only).