---
name: env-database-targets
description: DATABASE_URL in .env points at the shared Neon database; TEST_DATABASE_URL is the localhost one — never run seed/migrate without checking which
metadata:
  type: project
---

As of 2026-08-27, `.env` sets `DATABASE_URL` to the **shared Neon** database and
`TEST_DATABASE_URL` to **localhost**. So `npm run db:migrate` / `npm run db:seed`
with no override hit the shared database holding real bookings.

**Why:** the project keeps one `.env` for dev against Neon, and a separate local
Postgres only for the Vitest suite (`tests/setup.ts` refuses non-localhost).

**How to apply:** before any write command, check the target host without ever
printing the URL — e.g. `new URL(process.env.DATABASE_URL).hostname` and print
only a boolean. Verify local Postgres is actually up (it was ECONNREFUSED on
2026-08-27); if it is down, report it as an infrastructure problem instead of
falling back to Neon. See [[repo-crlf-working-copy]].

**Verified 2026-08-28:** `prisma.config.ts` builds the datasource from
`process.env.DATABASE_URL` and does `import "dotenv/config"`. dotenv does **not**
override an already-exported variable, so
`export DATABASE_URL="$(grep -E '^TEST_DATABASE_URL=' .env | sed -E 's/^TEST_DATABASE_URL=//; s/^"//; s/"$//')"`
in the same bash call reliably forces every Prisma command onto local
`orthocare_test`. `prisma migrate status` then prints the host itself, which is a
free confirmation that the override took.
