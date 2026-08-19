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

## Deployment

- **Vercel linked to GitHub; `main` auto-deploys and is live** (build green).
- Two build fixes were required along the way:
  1. `package.json` gained `"postinstall": "prisma generate"` — without it the
     generated client (gitignored) is missing at build time and `next build`
     fails typechecking on `@/generated/prisma/client`.
  2. `prisma.config.ts` uses `process.env.DATABASE_URL ?? ""` instead of the
     `env("DATABASE_URL")` helper, so `prisma generate` (during `npm install`)
     works even when `DATABASE_URL` is unset in the build environment.
- The project URL shows Vercel's login screen until a custom domain is set
  (expected on the free tier without a domain configured).

## Shared database (Neon)

- The team shares **one Postgres database on Neon** (via Vercel). Both
  developers put the same `DATABASE_URL` in their local `.env`, so data created
  by one is visible to the other.
- Local `TEST_DATABASE_URL` stays on a local Postgres so automated tests never
  touch the shared DB.
- Initial migration applied to the shared Neon DB; app connectivity verified.

## Not done

- **Staging environment** — a second, permanent preview env with its own DB /
  synthetic data / mock messaging. Can be added later; the shared Neon DB and
  env vars are already in place.
- Known advisory: `deepmerge-ts` (Prisma CLI-only, non-exploitable in app;
  `fix --force` would downgrade Prisma — deferred).
- Full domain schema + real seed land in Task 3a/3b.

## Notes for the teammate

- Prisma 7 is config-file based (`prisma.config.ts`), client generated into
  `src/generated/prisma` (gitignored, regenerate with `npx prisma generate`),
  connection via `@prisma/adapter-pg`.
- Tailwind 4 is config-less (`@tailwindcss/postcss`, no `tailwind.config.ts`).
- Work is committed and pushed to `main` (auto-deploys to Vercel).
- **To connect to the shared DB:** copy `DATABASE_URL` from Vercel → Storage →
  your Neon database into your local `.env`. Keep `TEST_DATABASE_URL` local.
