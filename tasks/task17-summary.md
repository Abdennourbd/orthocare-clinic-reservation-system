# Task 17 — Waitlist / Cancellation Alerts

**Status:** ✅ Complete — all 9 acceptance boxes in `tasks/todo.md` checked (2026-09-03, close-out session).

**Delivery timeline:** Sep 3 — domain subscriber `7dd17d5`, staff API `d7045f8`, admin UI `4feb853`, integration `a1e8b30`, review fixes `0a37c8b` (real self-service path) + `933b3f5` (delete banner). Close-out: `4c7276a` (book-on-claim cleanup), `e5b2217` (dashboard polish), `eb161dd` (review fixes), `f2a20cd` (delete-cancel focus return).

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

## Close-out session (2026-09-03) — boxes checked

The implementation existed but all `todo.md` boxes were unchecked and one box was genuinely open. A plan subagent audited the 9 boxes vs the code and found a single gap: **box 6 ("claimed slot deactivates entry")** — notification deactivated entries, but a watcher who booked a watched date directly kept a stale ACTIVE entry that would SMS later. Two user rulings: (1) add a book-on-claim hook, (2) keep the `WAITLIST_ENTRY_ADDED + removed:true` DELETE audit (no enum migration).

### What changed
- **`src/lib/waitlist/claimWaitlist.ts` (new, `4c7276a`)** — `deactivateClaimedWaitlistEntries(tx, …)`: finds the booking patient's ACTIVE entries for the booked service, matches `preferredDates` on the booked slot's clinic-local date (`toClinicLocalDateString` both sides, same convention as the subscriber), sets `active=false` with `notifiedAt` left NULL (claimed ≠ notified). Never throws — cleanup can never break a booking. Called from `bookSlotInTx`, the single choke point covering public booking, admin manual booking and reschedules, in the same transaction.
- **`tests/integration/waitlist-claim.test.ts` (new, 2 tests)** — booking a watched date deactivates with `notifiedAt` null; booking a different date/service leaves entries active.
- **Dashboard polish (`e5b2217`)** — status filter Actives/Inactives/Toutes (API already supported `active=false/all`, dashboard hardcoded `true`), "Charger plus" cursor pagination past the 50-row page, Esc-cancel + autofocus on the delete confirm.
- **Review fixes (`eb161dd`)** — code-reviewer Required ×3: delete trigger renders only for `active` rows (inactive DELETE is an indistinguishable 404 by design); bad cursor `P2025` maps to 400 `INVALID_CURSOR` instead of 500; "Notifiées" renamed "Inactives" (the bucket also holds claimed + manually-removed entries). Test-engineer gap: self-service test now carries date + service decoys asserting silence, so box 9's "not for non-matching ones" is proven on the self-service path, not just staff-cancel.
- **Focus return (`f2a20cd`)** — Esc/Annuler re-focuses the row's Supprimer trigger (re-queried by aria-label: the trigger unmounts while its panel is open, so a node ref dangles). Verified live: `document.activeElement` is the Supprimer button after Esc.

### Review loop
| Round | Findings | Resolution |
|---|---|---|
| Plan subagent | 1 real gap (box 6) + UI polish list | User rulings taken, implemented |
| Code-reviewer | REQUEST CHANGES — 3 Required (inactive-row delete, cursor 500, label) | All fixed `eb161dd` |
| Security-auditor | PASS — 0 Critical/High/Medium, 1 Low (non-atomic consume race: two concurrent slot-freed events can double-SMS) + 3 Info | Low deferred (needs claim-before-send redesign; single-instance v1 risk accepted, documented below) |
| Test-engineer | 48/48 green but flaky across runs (pre-existing fire-and-forget + TRUNCATE timing, also on baseline); box 9 negative half missing on self-service path | Decoys added; flakiness noted as follow-up |

### Verification (2026-09-03, fresh)
```
npm test          → 71 files / 828 green, 0 failures
npm run typecheck → clean
npm run lint      → clean
npm run build     → success
Browser (:3000)   → login → /admin/waitlist renders (form + service filter + Actives/Inactives/Toutes + table rows + Supprimer on actives only); Actives→Inactives→Actives filter round-trip; delete confirm autofocuses "Confirmer", Esc closes + focus returns to Supprimer; zero console errors; waitlist APIs 200; no third-party calls. Screenshots unattainable (DevTools screenshot path timed out twice — infra, not app); DOM snapshots used instead.
```

## Deferred (non-blocking)
- Security Low (atomic consume: claim-before-send so concurrent slot-freed events can't double-SMS; must preserve opt-out-stays-active) — small redesign, scheduled next.
- Waitlist suite flakiness (fire-and-forget subscriber tail vs per-test TRUNCATE; fixed sleeps) — stabilize with subscriber drain instead of sleeps.
- Review Optional/Nits carried forward: loadMore failure surfacing, `role="alertdialog"` + document-level Esc, focus-to-notice after successful delete, reschedule notifying the rescheduler's own old-date entry (v1-acceptable).
- Security Important ×2 (emitter try/catch; durable out-of-process fan-out for multi-instance) — deployment-model follow-ups.
- Review Optional: status filter (Actives/Notifiées/Toutes — API already supports it, dashboard hardcodes `active=true`), cursor "Charger plus" (50-row cap), deactivate-on-soft-delete entries (stale scan).
- Review Nits: UTC-day test helper (safe at daysAhead 5), sleep-based negative assertions (generous windows).
- Env note (web test): dev-DB admin password had diverged from `.env` (seed upsert `update:{}` never repairs); re-hashed locally. Team: decide canonical dev credential or make seed reset it.
