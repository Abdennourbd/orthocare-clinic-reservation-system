# Task 12 — Auth + RBAC + Audit Helper + Dashboard Shell

**Status:** ✅ Complete (see `tasks/todo.md` for the checked acceptance criteria)

**Review loop:** two full review rounds (code-reviewer / security-auditor / test-engineer). Round 1 fixes: iat-anchored absolute expiry, timing-equalized login, `mustChangePassword` API enforcement, fail-closed CSRF, no shared unknown-IP bucket, audit query Zod validation, logout origin check, method-level authz-matrix guard, DB-backed content tests. Round 2 fixes: proxy redirect-loop for revoked sessions (login page always reachable), lockout counter reset on lock expiry, change-password throttle, pinned argon2 params + DUMMY_HASH drift test, per-IP limiter test, clinic-local "today" on dashboard home. Final: **349/349 tests**, typecheck + lint clean.

## What was delivered

### Auth library (`src/lib/auth/`)
| Module | Purpose |
|---|---|
| `password.ts` | argon2id hashing (`type` pinned explicitly), 12-char minimum, small common-password blocklist (matched case-insensitively) |
| `session.ts` | HMAC-SHA256-signed session token (Web Crypto — importable from proxy *and* route handlers), `__Host-orthocare_session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`), absolute expiry 12h, idle expiry 2h (sliding `lastActive` claim), `tokenVersion` claim |
| `guard.ts` | `requireStaff(request, { roles })` — the authoritative per-request check: signature/expiry → DB lookup (exists, `active`, `tokenVersion` match) → role gate. Returns a refreshed session cookie for the sliding idle window (`withRefreshedSession`). Also `assertSameOriginStrict` (CSRF) and `getStaffFromCookies` (server components) |

### API routes
- `POST /api/auth/login` — throttled per IP (20/5 min) and per account (10/5 min), 5 failures → 15-minute lock, all attempts audited (`LOGIN_SUCCESS`/`LOGIN_FAILED`/`LOGIN_LOCKED`), generic error text (no account enumeration), CSRF origin check
- `POST /api/auth/logout` — clears cookie, audits `LOGOUT`
- `GET /api/auth/me` — current staff user; doubles as the sliding-session refresher
- `POST /api/auth/change-password` — verifies current password, enforces policy, bumps `tokenVersion` (revokes all other sessions), clears `mustChangePassword`, issues a fresh cookie, audits `PASSWORD_RESET`
- `GET /api/admin/audit` — **ADMIN only**, filters (`action`, `entityType`, `entityId`, `userId`, `from`, `to`) + pagination, newest first; the read itself is audited (`AUDIT_VIEWED`)

### Proxy guard (`src/proxy.ts`)
`/admin*` is session-gated at navigation time (redirect → `/admin/login`; already-authenticated visitors skip the login page). The authoritative DB re-check stays in `requireStaff`/`getStaffFromCookies` — the proxy is the cheap first gate, never the only one. API routes guard themselves and are excluded from the matcher.

### Dashboard shell (FR only, `dir="ltr"` explicit)
- `src/app/admin/layout.tsx` — root layout for the dashboard segment
- `src/app/admin/login/page.tsx` + `LoginForm` (client)
- `src/app/admin/change-password/page.tsx` + `ChangePasswordForm` (outside the guarded group so the forced-change redirect cannot loop)
- `src/app/admin/(dashboard)/layout.tsx` — authoritative guard + role-gated `Sidebar` + `LogoutButton`
- `src/app/admin/(dashboard)/page.tsx` — dashboard home placeholder (real KPIs = Task 18)
- `src/app/admin/(dashboard)/audit/page.tsx` + `AuditViewer` (client) — ADMIN only, double-enforced (page redirect + API 403)

Keyboard navigable with visible focus rings throughout (`focus-visible:ring-2 …`).

### Tests (TDD — written first, watched failing, then implemented)
- `src/lib/auth/password.test.ts` — policy (length, common list) + argon2id round-trip
- `src/lib/auth/session.test.ts` — round-trip, tamper rejection, wrong-secret rejection, absolute 12h, idle 2h boundary (121 min rejected / 119 min accepted), cookie header attributes, clear cookie
- `src/lib/auth/guard.test.ts` — valid session, anonymous 401, deactivated 401, deleted user 401, tokenVersion revocation 401, role gating 403/200, strict CSRF (same-origin ok, cross-site reject, Referer fallback, localhost exemption)
- `tests/integration/auth.test.ts` — login success/wrong-password/lockout-at-5/deactivated/rate-limit 429/CSRF 403/validation 400; `/me` with and without session; logout audit + cookie clear; change-password full flow (tokenVersion bump revokes old session, new cookie works, `mustChangePassword` cleared, audited) + wrong current password + weak password + no session
- `tests/authz-matrix.test.ts` — **the standing authorization matrix**: every `/api/admin/*` route × {anonymous, receptionist, admin, deactivated}; plus a filesystem guard that fails when a route is added without a matrix row. Audit API behavior tests (filters, pagination, `AUDIT_VIEWED`) live in the same file

## Notes & decisions
- `SESSION_SECRET` added to `.env.example` (generate with `openssl rand -hex 32`); rotating it logs everyone out (safe). ⚠ `APP_URL` must be set to the real origin in production — the strict origin check now fails closed without it.
- Login rate-limit limits (20/5min IP, 10/5min account) and lockout (5 fails / 15 min) chosen per plan.md §Abuse controls; the failure counter resets when a lock expires (no indefinite re-lock).
- Argon2 cost params are pinned in `password.ts` (`ARGON2_OPTIONS`) and `DUMMY_HASH` is drift-guarded by a unit test.
- `getStaffFromCookies` dynamically imports `next/headers` so `guard.ts` stays importable from non-RSC contexts. Page-level role checks stay per-page (audit page); the API layer is the authoritative gate.
- Follow-ups accepted (non-blocking): CSP `unsafe-inline`/`unsafe-eval` tightening → Task 23; `TRUST_PROXY` flag for self-hosted per-IP limiting → pre-existing `clientIp.ts` design, revisit at deploy hardening.
- Pre-existing `tests/public-content.test.ts` mock-based tests rewritten against the real test DB (project test strategy: no mocks-of-mocks).
- `npm run build` cannot complete in the current offline environment (Google Fonts fetch); typecheck + lint + full test suite are green. Build must be re-verified where fonts.googleapis.com is reachable.
