# Task 18 — KPIs overview

**Status:** ✅ Complete (bounded path: short in-chat design approved; full verification green)

**Delivery timeline:** Sep 3 — pure aggregation lib `0bf7a22`, endpoint + matrix `6ca2bc2`, dashboard UI `71e20bb`, review fixes `11d03e5`. Reviews by code-reviewer + security-auditor + test-engineer (parallel subagents) before sign-off.

## What was delivered

### Backend
- **`src/lib/kpis/aggregations.ts`** — pure functions (no DB, no Next.js): `getClinicWeekRange` (current Sat→Thu week; on Friday returns the previous completed Sat→Thu since Friday is closed), `computeOpenMinutes` (working-hours Setting only, Fri = 0, 370-iteration guard), `computeKpis` (total, pending, today, new patients, booked/open minutes, utilization, no-show rate, online share, auto-expiry rate, median confirm minutes). All date maths through `lib/time/clinicTime.ts`. `CANCELLED` + `RESCHEDULED` excluded from booked minutes and today count (a reschedule's old row is stale — the new row holds the slot). Null rates (never NaN) when denominators are 0.
- **`src/schemas/kpis.ts`** — `kpisQuerySchema`: optional clinic-local `from`/`to` (YYYY-MM-DD); omitted sides default to the clinic week. FR messages.
- **`src/app/api/admin/kpis/route.ts`** — `GET /api/admin/kpis?from=&to=`. Handler order `requireStaff(ADMIN+RECEPTIONIST)` → staff-keyed rate limit (appointments-read pool) → Zod → `from<=to` + 366-day cap → parallel reads (appointments + patients in UTC bounds + workingHours Setting) → pure agg. No audit row (counts/rates only — same ruling as SMS batches). No CSRF on GET. Named-field selects only (no `visitNotes`, no patient relation).
- **`tests/authz-matrix.test.ts`** — 1 row `GET /api/admin/kpis` → `[ADMIN, RECEPTIONIST]`, real-export handler reference.

### UI (`/admin`, FR dashboard)
- **`src/components/admin/KpiCards.tsx`** — 8 presentational cards reusing the Task 12 shell (rounded border, no gradients): today, call queue, new patients, utilization, no-show, online share, median confirmation (`"1 h 30"` / `"45 min"`), auto-expiry. French `fr-FR` percent formatting, `"—"` for null. `region[aria-label="Indicateurs clés"]`, responsive 1/2/4 columns.
- **`src/app/admin/(dashboard)/page.tsx`** — server page computes the week server-side via the same lib (no fetch round-trip), week label `"Semaine du sam. 29 août au jeu. 3 sept."` (via exported `CLINIC_TIMEZONE`), footnote on the Sat–Thu clinic week. `"En attente d'appel"` is the GLOBAL queue (spread, not mutation — the API returns the week's slice by design).
- **`src/lib/time/clinicTime.ts`** — `CLINIC_TIMEZONE` exported (was private) so the dashboard label can't drift from the module that owns the timezone.

### Tests
- **`src/lib/kpis/aggregations.test.ts`** — 6-appointment week fixture → exact numbers (total 6, booked 120, open 2520, no-show 0.5, online 5/6, expiry 0.2, median 60); Thu/Sat/Fri + Sun–Wed week offsets; Fri = 0 open minutes; odd-count median + negative-diff discarded; empty range → nulls (utilization 0 on an open day).
- **`tests/integration/kpis.test.ts`** — default week range, explicit range, invalid date 400, from>to 400, >366 days 400, omitted-side defaults, missing workingHours → 200 with null utilization, anon 401 + zero audit rows, authorized read + zero audit rows, exact open/booked/utilization assertions.
- **`src/components/admin/KpiCards.test.tsx`** — 8 French labels, `"1 h 30"` median, 5 dashes on nulls, `formatPercent` French comma (`"4,8 %"`) + sub-hour/exact-hour + NaN → `"—"`.

## Verification
`npm test` **797/797 green** (68 files; +27 since Task 17), `npm run typecheck` + `npm run lint` + `npm run build` clean (`/api/admin/kpis` in output). Browser: admin login → `/admin` shows all 8 cards + week label, `/api/admin/kpis` 200 with `{range:{from:"2026-08-29",to:"2026-09-03"}}`, mobile 390px single-column stacks, zero console errors.

## Notes / decisions
1. **Utilization denominator = working-hours only** (human call): closures ignored for v1.
2. **Both roles read, no audit** (human call): aggregates only, no names/phones/notes.
3. **Week = Sat→Thu** (human call): Friday shows the previous completed week; Friday today-count reads 0 by design (documented in page).
4. **RESCHEDULED excluded from today-count** (reviewer major — fixed): stale row, new row holds the slot.
5. **Security verdict SECURE** (0 critical/high/medium; 1 low accepted: 366-day in-memory aggregation bounded by cap + rate limit; single-clinic scale).
6. **Follow-ups (accepted, not lost):** `@@index([startTime])` on Appointment (+`[createdAt]` on Patient) when volume grows; dedicated `kpis-read` rate-limit pool if dashboard/day-view traffic collides; one-notification-per-entry stays v1 (Task 17).
