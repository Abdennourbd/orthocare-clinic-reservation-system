# Task 19 — CSV/Excel export

**Status:** ✅ Complete (bounded path: short in-chat design approved; full verification green)

**Delivery timeline:** Sep 3 — export lib + schemas + API + matrix `e2b06df`, dashboard UI (follow-up commit), tests (follow-up commit), review fixes `4e0e372`. Reviews by code-reviewer + security-auditor + test-engineer (parallel subagents) before sign-off.

## What was delivered

### Backend
- **`src/lib/exports/appointments.ts`** — pure builders (no DB, no Next.js): `getClinicMonthBoundsUTC` (clinic-local month → UTC bounds, delegates per-day to `clinicTime.ts`), `buildExportRows` (named fields only, E.164 phone, FR service name via `localized()`), `toCSV` (`;` delimiter + UTF-8 BOM for French Excel + RFC-4180 quoting + OWASP formula-injection guard), `toXLSX` (server-only `xlsx` write: header row frozen + autofilter + column widths), `exportFileName` (safe `export-rendez-vous-YYYY-MM.ext`).
- **`src/lib/exports/rateLimits.ts`** — dedicated `EXPORTS_RATE_LIMIT` (20/5min, session-userId-keyed) so download bursts never starve the day view / call queue.
- **`src/schemas/exports.ts`** — `appointmentsExportQuerySchema` (`month` YYYY-MM regex, `format` csv|xlsx enum, `includeNotes` strict `"true"` opt-in default false) + `daySheetQuerySchema` (`date` regex + real-calendar-day refine). FR messages.
- **`src/app/api/admin/exports/appointments/route.ts`** — `GET …?month=&format=&includeNotes=`. ADMIN-only; handler order `requireStaff` → rate limit → Zod → read → audit → bytes (400 never precedes 401/403). Notes column not even selected unless opted in. Audited `EXPORT_GENERATED` with month/from/to/format/includeNotes/rowCount (counts only, never names/phones/notes). `attachment` + `nosniff` + `no-store`.
- **`src/app/api/admin/exports/day-sheet/route.ts`** — `GET …?date=` printable day schedule JSON (clinic-local bounds, startTime-ordered, time/patient/phone/service/status). ADMIN-only, same guards, audited `EXPORT_GENERATED` with date/rowCount, `no-store` + `nosniff` on the JSON.
- **`tests/authz-matrix.test.ts`** — 2 rows (`…/exports/appointments`, `…/exports/day-sheet` → `[ADMIN]`, `okStatus: 400` proving guard-before-validation), real-export handler references.

### UI (`/admin/exports`, FR dashboard, ADMIN-only page + sidebar entry)
- **`src/components/admin/ExportsDashboard.tsx`** — monthly card (month picker, CSV/XLSX radios, include-notes checkbox with warning, download anchor, audit hint) + day-sheet card (date picker, preview table with Heure/Patient/Téléphone/Soin/Statut, empty/loading/error states, Imprimer button printing only the sheet via `@media print` one-page CSS). Times formatted with `timeZone: "Africa/Algiers"` — never the browser TZ. No client `xlsx` import (URL-only).
- **`src/app/admin/(dashboard)/exports/page.tsx`** — server gate (`!staff` → login, non-ADMIN → `/admin`); APIs enforce independently. Sidebar adds “Exports” ADMIN-only.

### Tests
- **`src/lib/exports/appointments.test.ts`** — month bounds incl. leap Feb, row shaping + phone fallback, notes opt-in/out, BOM/`;`/RFC-4180 escaping, formula-injection neutralization, XLSX round-trip, filename.
- **`tests/integration/exports.test.ts`** — CSV bytes BOM + 2 in-month rows (next-month excluded) + notes absent by default; notes present on `includeNotes=true`; XLSX re-parsed from wire bytes; audit content + PII absence (monthly + day-sheet); 401/403/401 + zero audit rows on refusal; 400s (bad month/format/missing params/`includeNotes=maybe`/impossible date); day-sheet 3-row ordering; empty day + empty month (headers-only, `rowCount: 0`).

## Verification
`npm test` **826/826 green** (70 files; +29 since Task 18), `typecheck` + `lint` + `build` clean (`/admin/exports` + both API routes in output). Browser (admin login → `/admin/exports`): download link href correct, day sheet loads real data (11:30 clinic-local), CSV/XLSX/day-sheet all live-200 with correct MIME/disposition/`no-store`, anonymous → `/admin/login`, zero console errors, mobile 390px stacks (same fixed-sidebar shell as the rest of the dashboard).

## Notes / decisions
1. **CSV delimiter `;` + BOM** (human-implicit): French Excel opens accents and columns correctly; documented in lib.
2. **Day sheet = JSON API + print CSS** (not PDF): paper fallback prints from the preview; one-page CSS verified in browser, real paper print stays manual.
3. **Utilization of dedicated rate-limit pool** (reviewer-aligned): exports never contend with the receptionist's read pool.
4. **Code review MAJOR fixed**: day-sheet times were browser-TZ; now pinned to `Africa/Algiers`.
5. **Security verdict SECURE** (0 critical/high/medium; 2 low fixed: CSV formula-injection guard, day-sheet `no-store`; info: `xlsx@0.18.5` CVEs are read-path-only, module is write-only — bump opportunistically).
6. **Follow-ups (accepted, not lost):** bump `xlsx` ≥0.19.3; gate exports page on `mustChangePassword` for consistency (API already fails closed); heavy-day sheets may paginate past one page (acceptable MVP).
