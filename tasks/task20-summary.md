# Task 20 — Team management

**Status:** ✅ Complete (bounded path: short in-chat design approved; full verification green)

**Delivery timeline:** Sep 3 — team API + schemas + tests `c710cb5`, dashboard UI `7b1b0e5`, review fixes `da78427`, confirm-label a11y fix `5827627`. Reviews by code-reviewer + security-auditor + test-engineer (parallel subagents) before sign-off. Design decisions: receptionist-only creation (role change for promotion), admin-typed one-time passwords (user call).

## What was delivered

### Backend
- **`src/schemas/team.ts`** — `teamCreateSchema` (name/email/password), `teamPatchSchema` (name/role/active, refine ≥1 field), `teamResetPasswordSchema` (newPassword). FR messages. Shape checked here, policy via `validatePasswordPolicy()` in routes so failures report `WEAK_PASSWORD`, not flat `VALIDATION_ERROR`.
- **`src/lib/team/rateLimits.ts`** — `TEAM_READ` (60/5min) + `TEAM_WRITE` (30/5min), session-userId-keyed (shared front-desk IP reasoning, same as appointments/waitlist).
- **`src/lib/team/select.ts`** — one shared `teamRowSelect` (never a model spread — `passwordHash` can never serialize).
- **`src/app/api/admin/team/route.ts`** — `GET` list (createdAt-desc, no audit: staff data, not patient data) + `POST` create RECEPTIONIST-only (argon2id, `mustChangePassword=true`, `TEAM_MEMBER_CREATED`). Case-insensitive duplicate check + P2002 catch → same 409 `EMAIL_TAKEN` under race.
- **`src/app/api/admin/team/[id]/route.ts`** — `PATCH` name/role/(de)activation. (De)activation bumps `tokenVersion` (instant session revocation); role/name do not (guard reads live DB role). Self-deactivate/self-demote blocked; last-admin removal blocked — all three inside one **serializable transaction** (check-and-mutate atomic, P2034 → 409). Audits: `TEAM_MEMBER_DEACTIVATED` with `{from,to}` (reactivation reuses it — no enum value exists), `TEAM_MEMBER_ROLE_CHANGED` with `{from,to}`; name-only edits intentionally unaudited.
- **`src/app/api/admin/team/[id]/reset-password/route.ts`** — `POST` admin-typed temp password (policy-checked), `tokenVersion++`, `mustChangePassword=true`, lockout cleared (reset unlocks). Self-reset blocked (`CANNOT_RESET_SELF` → change-password page instead). Audited `PASSWORD_RESET` (`{forced:true}`); temp password never logged/audited/returned. Resetting a deactivated account allowed on purpose (pre-stage for reactivation — still cannot log in until reactivated).
- **`tests/authz-matrix.test.ts`** — 4 rows (all `[ADMIN]`; `okStatus: 400` where `requestAs` sends no body, proving guard-before-Zod-before-DB), direct export references.

### UI (`/admin/team`, FR dashboard, ADMIN-only page + sidebar entry)
- **`src/components/admin/TeamDashboard.tsx`** — create card (Nom/Email/temp password, native validation via in-form submit, policy hint) + members table (Nom/Email/Rôle select/Statut badges/Dernière connexion Africa/Algiers/Actions). Two-click inline confirm for (de)activation (never a dead-end modal), expandable reset form (min-12 gating), `(vous)` self-row with disabled controls, `role=status`/`alert` live regions, dynamic confirm `aria-label`, skeleton/empty/error+retry states, `overflow-x-auto` table. Same teal/slate language as ExportsDashboard.
- **`src/app/admin/(dashboard)/team/page.tsx`** — server gate (`!staff` → login, non-ADMIN → `/admin`; `mustChangePassword` funnel handled by the dashboard layout). Sidebar adds "Équipe" ADMIN-only.

### Tests
- **`tests/integration/team.test.ts`** — 17 tests: create happy path + audit + no-password-in-audit, `WEAK_PASSWORD`/`EMAIL_TAKEN` (+case-insensitive) codes, list/create never leak `passwordHash`, deactivate bump + `{from,to}` audit, deactivated-can't-login + live-session-401, `PASSWORD_CHANGE_REQUIRED` gate, promote-to-ADMIN without revocation + role audit (existing session gains access), reactivate bump, exact `CANNOT_DEACTIVATE_SELF`/`CANNOT_DEMOTE_SELF`, `LAST_ADMIN` (lone self-removal both ways + 2-admin demote keeps 1 admin), empty-body 400 + unknown-id 404, name-only edit writes zero audit rows, reset happy path + revocation + `forced` audit + no password in detail, weak/self/unknown-id reset paths, full reset→login→change-password cycle (temp dies after rotation), reset-unlocks-locked-account.

## Verification
`npm test` **861/861 green** (72 files), `typecheck` + `lint` + `build` clean (`/admin/team` + 3 API routes in output). Browser (dev server): create → deactivate → reset → reactivate + full receptionist cycle (login with temp → forced `/admin/change-password` → rotation → dashboard; `/admin/team` redirects to `/admin` for receptionist; nav hides Exports/Équipe/Journal). Network: GET 200s, POST 201, PATCH 200, reset 200. Console: zero errors/warnings (dev Fast-Refresh logs only). Mobile 500px: form stacks, table scrolls in-container, same fixed-sidebar shell as the rest of the dashboard.

## Notes / decisions
1. **Receptionist-only creation** (user call): `POST` never mints ADMIN; promotion is `PATCH` + `TEAM_MEMBER_ROLE_CHANGED`.
2. **Admin-typed temp passwords** (user call): policy-enforced on both paths; `mustChangePassword` forces rotation at next login.
3. **Review MAJORs fixed**: email P2002 race, serializable last-admin transaction, self-reset block, submit-inside-form (single native-validation path).
4. **Security verdict SECURE** (0 critical/high/medium; 2 low fixed or documented: last-admin atomicity, reactivation audit detail; 409 `EMAIL_TAKEN` enumeration acceptable — caller is ADMIN who can list all staff anyway).
5. **Accepted non-changes:** `mustChangePassword` page gate already covered by dashboard layout redirect; no pagination (staff table bounded); load-skeleton flash on mutation kept (matches sibling dashboards).
6. **Web-test accounts removed** (`browser-admin-t20@`, `lina.reception@` + their audit rows deleted from dev DB; no temp scripts left in repo).
