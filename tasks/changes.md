# Changes — v2 → v3

No section was removed or reorganized. No task was renumbered. Everything below is an addition or a clarification inside an existing section.

## plan.md

- Added section "Goals, Non-Goals & Success Metrics" (5 goals, 6 non-goals, 6 measured targets)
- Added timezone rule: store UTC, compute in Africa/Algiers, cron schedules documented in UTC
- Added abuse controls: rate limits on booking + login, PENDING cap per phone, optional bot check
- Added PENDING auto-expiry (unconfirmed bookings stop blocking slots forever)
- Added booking-window rules: minimum lead time, maximum horizon, no past dates
- Added single-resource ("one chair") assumption, stated explicitly + `resourceId` seam for later
- Added `ScheduleException` model — closures for holidays, Eid, vacation, emergency
- Added phone normalization to E.164 (`phoneE164`, indexed) for duplicate detection + messaging
- Added `reminderSentAt` + unique index on `SmsMessage(appointmentId, type)` — cron can't double-text
- Added consent capture (`consentAt`, `consentVersion`), `messagingOptOut`, transactional vs non-transactional split
- Added data retention + erasure-by-anonymization (`anonymizedAt`) policy
- Added privacy notice page + processor list + cross-border transfer note (Law 18-07)
- Changed documents to private blob storage + authenticated download route, MIME allow-list, `nosniff`
- Changed `logAction(userId, …)` → `logAction(actor, …)` with `STAFF` / `SYSTEM` / `PATIENT`
- Added audit events for reads: record viewed, document downloaded, export generated, logins, audit viewed
- Added audit log as append-only, ADMIN-only to read
- Added session/CSRF/password rules: cookie flags, origin check, argon2id, 12-char minimum, admin-issued reset
- Added least-privilege rule: exports, audit, document deletion, settings, team = ADMIN only
- Added self-service token hardening: minimum disclosure, `no-referrer`, no third-party scripts, rotation, hashed at rest
- Added security headers + CSP (Google embed allow-listed)
- Added Sentry PII scrubbing, uptime monitoring, cron-silence alerting
- Added backups with a tested restore + printable day sheet as paper fallback
- Added staging environment (Task 22 assumed one existed; nothing created it)
- Added SEO requirements: hreflang, 301 redirects from old URLs, JSON-LD, canonicals, per-locale sitemaps
- Added launch cutover + rollback plan
- Added endpoints: call queue, appointment search, broadcast preview, closures, password reset, anonymize, day sheet, health, expire-pending cron
- Added authorization matrix test + token negative tests + synthetic-test-data rule to testing strategy
- Added sizing table, critical path, cut list, plan-to-75%-capacity note
- Added 20 risk rows; added 5 open questions (chairs, cross-border, retention, WhatsApp templates, Arabic numerals)
- Added "Dependency changes introduced by this revision" block flagging what moved

## todo.md

- Added a shared Definition of Done (incl. "audit logged?" and "authz test row added?")
- Added a `**Skill:**` line to all 24 tasks + a project-wide skills shortlist at the end
- Changed every `Estimated scope` from bare Small/Medium/Large to a day range
- Task 1 — added staging environment, rate-limit store, no-committed-secrets check
- Task 2 — added Arabic font subsetting
- Task 3a — added `phoneE164`, consent fields, `reminderSentAt`, `cancelReason`, `resourceId`; admin seed password from env
- Task 3b — added `ScheduleException` + booking-policy settings (flagged: Task 4 depends on both)
- Task 4 — added timezone conversion, closure subtraction, booking-window policy, local day-boundary tests
- Task 5 — added `cancelReason` on release
- Task 6 — added consent checkbox, rate limits, phone normalization, keyboard/screen-reader criteria, "we will call to confirm" wording
- Task 7 — added opt-out enforcement, per-staff notification fan-out, duplicate-send index
- Task 8 — added minimum disclosure, `no-referrer`, token rotation, hashed storage, 4 negative tests
- Task 9 — added PENDING-expiry cron, idempotency ("run twice, send once"), `/api/health`, SYSTEM actor
- Task 10 — added CSP allow-list, excluded from token pages, graceful failure
- Task 11 — added privacy notice page, image optimization, caching
- Task 12 — added actor-model signature change, login throttling, CSRF, cookie/session expiry, audit viewer, authorization matrix test
- Task 13 — added anonymization path, record-view auditing, cross-format duplicate matching
- Task 14 — added call queue + search by phone/name
- Task 15 — changed to private blobs + authenticated download; added MIME allow-list, `nosniff`, download auditing, ADMIN-only delete
- Task 16 — added broadcast preview + idempotency key, opt-out + cancelled excluded
- Task 17 — added auto-expiry as a trigger, opt-out respected
- Task 18 — added clinic-local date ranges + KPIs tied to the success metrics
- Task 19 — added printable day sheet, ADMIN-only, audited, notes excluded
- Task 20 — added admin-issued password reset
- Task 21 — added closure management + booking policy + affected-appointment handling
- Task 22 — added staging dependency, DZ cost check, WhatsApp template approval as a lead-time item
- Task 23 — added hreflang, 301 redirects, JSON-LD, security headers, Sentry scrubbing, uptime alerts, restore drill, cutover/rollback
- All 6 checkpoints extended with the matching verification lines