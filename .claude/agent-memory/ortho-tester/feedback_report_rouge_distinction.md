---
name: feedback-report-rouge-distinction
description: When DB infra is down, still write/extract tested code and reason through unit tests, but report npm test results honestly as infra-blocked rather than as pass/fail.
metadata:
  type: feedback
---

Even when `npm test` cannot succeed because the local Postgres is unreachable
(see [[project-test-infra-global-db-requirement]]), the useful work is not
skipped: extract untestable-in-place logic into its own module (e.g. pulled
`groupIntoBlocks` out of a `page.tsx` into `src/lib/public/galleryBlocks.ts`
so it's importable and unit-testable), write the full test file with real
fixtures and assertions, and run `npm run typecheck` + `npm run lint` (both
DB-independent) to validate the code compiles and is clean.

**Why:** the role instructions say "if the global setup fails, stop and report,
do not debug the code" — but a task can *know in advance* the DB is down and
still want the code/test authoring done, with the DB-dependent verification
step reported separately and honestly. Conflating "0 passed because DB is down"
with "tests are broken" would misrepresent the work.

**How to apply:** in the final report, keep the two facts separate — (1) code
change + test file were written and are typecheck/lint-clean, describing what
each test proves, and (2) `npm test` itself could not execute due to
`ROUGE — base injoignable`, with the exact failure signature (all files fail
identically at `tests/setup.ts` beforeEach, not at an assertion). Never claim
a test "passes" based on typecheck alone.
