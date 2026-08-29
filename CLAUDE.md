# Ortho'Care — Clinic Reservation System

Public booking site + (upcoming) staff dashboard for a dental/orthodontic clinic
in Algiers. **It stores real patient health data.** Trilingual FR/AR/EN with RTL.

> This file is loaded into every subagent's context. Keep it a table of contents,
> not an encyclopedia. Hard cap: 150 lines.

## Stack

TypeScript · Next.js 16 (App Router) · React 19 · next-intl · PostgreSQL (Neon)
· Prisma 7 · Zod · Tailwind · Vitest · npm · deployed on Vercel.

## Commands

| Purpose | Command |
|---|---|
| Dev server | `npm run dev` |
| Tests | `npm test` (Vitest) |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Migrate (dev) | `npm run db:migrate` · deploy: `npm run db:deploy` |
| Seed | `npm run db:seed` |

CI runs, in order: `npm ci` → `npm audit --audit-level=high` → `prisma generate`
→ `migrate deploy` → lint → typecheck → test → build. Keep all of them green.

**Tests need a local Postgres.** `tests/setup.ts` points at `TEST_DATABASE_URL`
and refuses any non-localhost URL — that guard protects the production Neon
database from its `TRUNCATE`. **Never edit or bypass `tests/setup.ts`.** If tests
fail because the database is unreachable, that is an infrastructure problem, not
a test failure — report it as such.

## Layout

```
src/app/api/**/route.ts      Route handlers (appointments, slots, services, cron, health)
src/app/[locale]/**          Localized pages (book, appointment/[token], services, …)
src/components/public/**     UI components (BookingWizard/, AppointmentManager/, home/)
src/lib/<domain>/            Business logic: booking, slots, selfservice, messaging,
                             cron, audit, security, settings, time, phone, i18n, maps
src/lib/db.ts                Prisma singleton — the ONLY way to reach the database
src/schemas/                 Zod schemas shared between route handlers and forms
src/i18n/ + messages/        Routing config + fr.json / ar.json / en.json
src/proxy.ts                 Next 16 request proxy (i18n routing; /admin excluded)
prisma/schema.prisma         Data model + migrations in prisma/migrations/
tests/integration/           Route-level integration tests (unit tests sit next to their source)
```

## Non-negotiable conventions

- Import via the `@/*` alias, never long relative chains.
- Reach the database **only** through `getPrisma()` (`src/lib/db.ts`). It is lazy
  on purpose so tests can redirect `DATABASE_URL` before the first connection.
- Errors: typed classes per domain (`src/lib/booking/errors.ts`,
  `src/lib/selfservice/errors.ts`), each documenting its HTTP status. Route
  handlers convert them with `ok()` / `errorResponse()` from `src/lib/api/http.ts`
  so every error is `{ error: { code, message } }`.
- Validation: one Zod schema in `src/schemas/`, imported by **both** the route
  handler and the form. Never duplicate the shape.
- Unit tests live beside their module as `*.test.ts`; route-level tests go in
  `tests/integration/`.
- Header comments explain **why**, and cite `plan.md §Section` where relevant.
  Match that density — this codebase documents its reasoning.
- Components are PascalCase, lib modules camelCase.
- Anything user-facing must work in all 3 locales and be checked for RTL (Arabic).

## Next.js 16 gotchas

This version diverges from most training data. Check
`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` before
writing framework-level code.

- `params` / `searchParams` / `cookies()` / `headers()` are **Promises** — await them.
- **`middleware.ts` is deprecated → the file is `src/proxy.ts`** and the export is
  `proxy`. Task 12's `/admin` protection belongs there; the matcher already
  excludes `/admin` from locale routing.
- Turbopack is the default bundler; ESLint uses flat config.

## Sensitive zones — patient health data

- Patient data lives in `Patient` (identity, phone, email, birthDate, notes,
  consent), `Appointment` (`visitNotes`), `SmsMessage`, `SelfServiceToken`,
  `WaitlistEntry`. Treat every one of them as confidential.
- **Never put patient data in a log, an error message, or a URL.** Self-service
  tokens travel in the URL, which is why those pages send `Referrer-Policy:
  no-referrer` and load no third-party script (`src/lib/security/headers.ts`).
  Never add an external domain to that policy.
- Call `logAction()` (`src/lib/audit/logAction.ts`) for any action touching
  patient or staff data. The audit log is append-only; reads are audited too.
- API responses return the **minimum** fields the caller needs — see the
  self-service GET route for the reference example.
- Security helpers: `rateLimit.ts`, `origin.ts` (CSRF), `headers.ts` (CSP),
  `cronAuth.ts`, `clientIp.ts` — all under `src/lib/security/`.
- Secrets come from `process.env`; `.env` is gitignored. **Never print
  `DATABASE_URL`** — if it is ever echoed, it must be rotated in Neon.
- Test data is synthetic only. No production patient data in dev, test or staging.

### Not built yet

**There is no authentication.** The `Role` enum exists in the schema but no
permission check exists in code, and `tests/authz-matrix.test.ts` — required by
the Definition of Done — does not exist. All of that is Task 12.

## Steering documents

- **`tasks/todo.md` is the single source of truth** for what is done. Files named
  `tasks/task<N>-todo.md` are working notes, **not** authoritative. If the two
  disagree (known case: Task 11), surface the discrepancy and ask — never decide
  alone.
- `tasks/plan.md` holds architecture decisions. Update it when the architecture or
  data model changes.
- `tasks/task<N>-summary.md` is written when a task completes.
- The **Definition of Done** at `tasks/todo.md:7-14` applies to every task.

## Task relay file

Agents share no context. `.claude/tasks/task-<N>.md` is the only channel between
them: written by ortho-planner, updated by every agent that touches the step.
Read it before starting, append to the step Journal when done.

Task format in `tasks/todo.md`:

- Heading: `## Task <N>: <Title>` — anchor with `grep -nE '^## Task 11:' tasks/todo.md`
- Acceptance criteria: `- [x]` done / `- [ ]` not done
- Grouped under `## Phase N:` with `## Checkpoint: After Tasks X-Y` blocks
- Sub-tasks: `Task 3a` / `Task 3b`, and `Task 6R-1`…`6R-4` (refinements of Task 6,
  placed after Task 23 — not next to Task 6)

⚠️ `docs/superpowers/` contains plans with **their own unrelated Task 1/2/3
numbering**. A bare `grep "Task 11"` will hit them. Always anchor on `^## Task <N>:`.
