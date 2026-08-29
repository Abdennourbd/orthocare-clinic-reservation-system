---
name: project-test-infra-global-db-requirement
description: In this repo, vitest.config.ts wires tests/setup.ts as a global setupFile, so even pure-logic unit tests fail without a reachable local Postgres.
metadata:
  type: project
---

`vitest.config.ts` lists `setupFiles: ["./tests/setup.ts"]` for the whole suite
(not just `tests/integration/`), and `tests/setup.ts` runs a `beforeEach` that
calls `getPrisma().$executeRawUnsafe(TRUNCATE ...)` before *every single test*,
including ones colocated with source that touch no database at all (e.g.
`src/lib/booking/mergeSlots.test.ts`, or the new
`src/lib/public/galleryBlocks.test.ts`).

**Why:** confirmed directly on 2026-08-27 — with no local Postgres listening on
5432, `npm test` failed all 31 test files / 272 tests with the identical error
`PrismaClientKnownRequestError ... at tests/setup.ts:32:3`, even for files with
zero DB interaction in their own code. `npm run typecheck` and `npm run lint`
are unaffected (they don't invoke vitest) and can still validate code changes
when the DB is down.

**How to apply:** when a task dispatcher assumes "pure unit tests can still run
without the local Postgres," correct that assumption — they cannot, structurally,
in this repo. Do not try to work around it (e.g. don't add a separate vitest
config without the global setupFile, don't touch `tests/setup.ts` — both are
out of bounds). When the DB is unreachable, still write and reason through the
unit tests (extract logic to a testable module, write correct fixtures/assertions,
lean on `npm run typecheck` to catch shape errors), but report the actual `npm
test` run honestly as infrastructure-blocked (`ROUGE — base injoignable`), not
as passing or failing tests. See [[feedback-report-rouge-distinction]].
