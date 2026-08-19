# Task 1 — Scaffold project (summary)

What was done in Task 1: initialize the project skeleton, DB, testing, CI, and
rate-limit store. See `tasks/todo.md` → Task 1 for the spec, `tasks/plan.md`
for architecture.

## Done + verified (all green)

- **Environment:** Node 26, npm 12, Postgres 18 installed; local DBs
  `orthocare_dev` (dev) and `orthocare_test` (tests) created.
- **Next.js 16** (App Router, TypeScript, Tailwind 4, ESLint) in `src/` layout.
  `npm run dev` serves HTTP 200; title "Ortho'Care Clinic".
- **Prisma 7 + Postgres:** `prisma.config.ts`, schema with the
  `RateLimitCounter` model, initial migration applied to **both** dev and test
  DBs; seed script wired (placeholder until Task 3a).
- **Rate limiter:** `src/lib/security/rateLimit.ts` — Postgres-backed atomic
  fixed-window limiter; 4 unit tests pass.
- **Vitest:** `vitest.config.ts` + `tests/setup.ts` (points Prisma at the test
  DB, truncates tables between suites).
- **DB client singleton:** `src/lib/db.ts`.
- **`.env.example`** documents every env var; `.env` gitignored (no secrets).
- **CI:** `.github/workflows/ci.yml` — on every push/PR: fresh Postgres, npm ci,
  migrate, lint, typecheck, test, build.
- **Verified:** `lint`, `typecheck`, `test` (4/4), `build` all pass.

## Files / dirs created

```
.env.example        .github/workflows/ci.yml   .gitignore
prisma.config.ts    prisma/schema.prisma       prisma/migrations/
prisma/seed.ts      src/app/                   src/lib/db.ts
src/lib/security/rateLimit.ts   + test        tests/setup.ts
vitest.config.ts    package.json (+ scripts)   next.config.ts  tsconfig.json
```

## Not done

- **Staging environment — blocked.** Requires a Vercel account + linking the
  GitHub repo (see question below). Env vars for it are already documented.
- Known advisory: `deepmerge-ts` (Prisma CLI-only, non-exploitable in app;
  `fix --force` would downgrade Prisma — deferred).
- Full domain schema + real seed land in Task 3a/3b.

## Notes for the teammate

- Prisma 7 is config-file based (`prisma.config.ts`), client generated into
  `src/generated/prisma` (gitignored, regenerate with `npx prisma generate`),
  connection via `@prisma/adapter-pg`.
- Tailwind 4 is config-less (`@tailwindcss/postcss`, no `tailwind.config.ts`).
- Nothing committed/pushed yet.
