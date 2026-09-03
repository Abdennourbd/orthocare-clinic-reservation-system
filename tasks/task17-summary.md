# Task 17 — Waitlist / Cancellation Alerts

**Status:** ✅ Complete (subagent-driven: 4 slices + review loop + web tests; verified end-to-end)

**Delivery timeline:** Sep 3 — domain subscriber `7dd17d5`, staff API `d7045f8`, admin UI `4feb853`, integration `a1e8b30`, review fixes `0a37c8b` (real self-service path) + `933b3f5` (delete banner).

## What was delivered

### Domain (17.1 — `7dd17d5`)
- **`src/lib/waitlist/notifyWaitlist.ts`** — `handleSlotFreed(event)` + `subscribeWaitlist()`. Matches ACTIVE entries on `serviceId` + freed slot's **clinic-local date** (`toClinicLocalDateString`, both sides — 23:30Z edge tested). Sends one WAITLIST SMS via the shared dispatcher (no `appointmentId`, same reason as Task 16 delay broadcast — the unique index would block a second offer). Consumes on any non-null send (`active=false` + `notifiedAt`); dispatcher-suppressed (opt-out/inactive) stays active for the next opportunity; anonymized skipped explicitly; sequential sends; never throws (cancellation can never 500 because of the waitlist).
- **`waitlist` template** in `templates.ts` (FR): "Bonjour {firstName}, une place {serviceName} s'est libérée le {date} à {time}…".
- **Wire-up** in `releaseSlot.ts` (single choke point: staff cancel, self-service cancel, expiry cron all route through it; reschedule via `releaseSlotInTx` import). Self-service has its own emit site (`selfServiceCancel` → own `emitSlotFreed` in single transaction with token consumption) — covered by the fixed integration test.

### Staff API (17.2 — `d7045f8`)
- **`src/schemas/waitlist.ts`** — list query (`serviceId`, `active: true/false/all` default `true`, limit/cursor) + create (patientId, serviceId, 1–10 × YYYY-MM-DD), FR messages.
- **`GET /api/admin/waitlist`** — newest-first, cursor pagination, service + active filters. Audited once as `PATIENT_RECORD_VIEWED` (rows carry names/phones).
- **`POST /api/admin/waitlist`** — STAFF-source entry, dates validated against live booking policy (`validateWatchDates`) and stored as UTC-midnight via `getClinicDayBoundsUTC`. Audited `WAITLIST_ENTRY_ADDED` (ids only).
- **`DELETE /api/admin/waitlist/[id]`** — soft-deactivate only; missing/already-inactive → indistinguishable 404. Audited as `WAITLIST_ENTRY_ADDED + removed:true` (enum has no REMOVED action — never invented one).
- Roles `["ADMIN","RECEPTIONIST"]` on all three (not ADMIN-only); load-bearing order `requireStaff → CSRF → rate-limit → Zod → domain`; dedicated staff-keyed pools (`rateLimits.ts`); 3 rows added to `authz-matrix.test.ts` by reference.

### Admin UI (17.3 — `4feb853`, fix `933b3f5`)
- `/admin/waitlist` (FR, `(dashboard)` group): `WaitlistDashboard` (container: fetch, service filter, skeleton `aria-busy`, error `role=alert` + retry, parent-owned `notice` banner `role=status`), `WaitlistForm` (submit-only patient search, service select, date multi-select min=today/max+90d/max10/dupe-deduped, pending-disabled, success reset), `WaitlistList` (patient + full phone staff-only, service FR via `localized`, dates DD/MM/YYYY, source badge En ligne/Guichet, notifiedAt, two-step inline delete confirm). Sidebar `+1` (`adminOnly:false`). Slate/teal, `rounded-md/text-sm`, `overflow-x-auto` table, keyboard-navigable with teal focus rings.

### Tests
- **Unit** `notifyWaitlist.test.ts` (9): match/mismatch, 23:30Z edge, opt-out/inactive/anonymized, FAILED-consume, both sources, unsubscribe.
- **Admin integration** `waitlist-admin.test.ts` (18): happy + past/horizon/invalid dates, unknown/anonymized patient, filters, deactivate + double-delete 404.
- **End-to-end** `waitlist.test.ts` (7): staff cancel, **real** `selfServiceCancel(token)` path (fixed per review — was direct `releaseSlot`), AUTO_EXPIRED, reschedule old-slot-only, opt-out stays active, one-notify-per-entry.
- **Components** (17): form validation/pending/success/error + list empty/rows/delete + dashboard banner-survives-reload regression.

## Review loop
| Round | Findings | Resolution |
|---|---|---|
| Security-auditor | APPROVE — 0 Critical/High, 2 Important (emitter without try/catch; in-process-only durability), 4 Minor | Important/Minor deferred (deployment-model decisions, documented) |
| Code-reviewer | REQUEST CHANGES — 1 Required (test-only: self-service test bypassed real path) + 3 Nit + 3 Optional | Fixed `0a37c8b` (real `selfServiceCancel` + doc reword); Nits/Optionals triaged below |
| Web (browser, dev server :3003) | All PASS, console **zero errors/warnings**; 1 medium UX bug (delete banner wiped by reload skeleton) | Fixed `933b3f5` (banner lifted to parent) |

## Verification (2026-09-03, fresh)
```
npm test          → 65 files / 770 green, 0 failures
npm run typecheck → clean
npm run lint      → clean
npm run build     → success
Browser           → render/guard/empty/filter/create(201+banner+row)/delete(200+row gone)/keyboard/320-768-1440/a11y-tree/network(200s, zero third-party) PASS; screenshots /tmp/waitlist-*.png
```

## Decisions / rulings
1. **SMS-only v1, no staff `WAITLIST_MATCH` fan-out** (enum exists, no helper — approved scope).
2. **Suppressed (opt-out) entries stay active** — patient keeps place for next opportunity; FAILED sends still consume (no poison-entry retry).
3. **No `appointmentId` on WAITLIST sends** — unique index would block second offer same day (Task 16 precedent).
4. **DELETE audited as `WAITLIST_ENTRY_ADDED + removed:true`** — no new enum value invented.
5. **Ruling (review conflict):** reviewer asked for real self-service path — accepted (acceptance box 9 explicit); fixed with zero production change.

## Deferred (non-blocking)
- Security Important ×2 (emitter try/catch; durable out-of-process fan-out for multi-instance) — deployment-model follow-ups.
- Review Optional: status filter (Actives/Notifiées/Toutes — API already supports it, dashboard hardcodes `active=true`), cursor "Charger plus" (50-row cap), deactivate-on-soft-delete entries (stale scan).
- Review Nits: UTC-day test helper (safe at daysAhead 5), sleep-based negative assertions (generous windows).
- Env note (web test): dev-DB admin password had diverged from `.env` (seed upsert `update:{}` never repairs); re-hashed locally. Team: decide canonical dev credential or make seed reset it.
