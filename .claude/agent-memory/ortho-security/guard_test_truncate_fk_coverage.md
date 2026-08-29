---
name: guard-test-truncate-fk-coverage
description: Test isolation relies on TRUNCATE ... CASCADE in tests/setup.ts reaching unnamed tables through their FKs — the SQL query that proves coverage for any new table
metadata:
  type: project
---

`tests/setup.ts` truncates a **hard-coded list** of 15 tables with
`RESTART IDENTITY CASCADE`. A table that is *not* in that list is still
cleaned **if and only if** it has a foreign key (transitively) to one of the
listed tables — `TRUNCATE ... CASCADE` is recursive. `Visit` (Task 13) is the
first table to rely on this.

**Why:** `tests/setup.ts` must never be edited (`CLAUDE.md` — it is the guard
that stops a `TRUNCATE` from reaching the shared Neon database holding real
patient data). So new tables cannot be added to the list; coverage has to be
*proven* instead, and the failure mode of a miss is silent cross-test
pollution of patient rows, not a red test.

**How to apply:** when a diff adds a table, run this against the local test DB
(force `DATABASE_URL` to `TEST_DATABASE_URL` first, check it contains
`localhost`, never print it):

```sql
SELECT c.conrelid::regclass, c.confrelid::regclass
FROM pg_constraint c WHERE c.contype = 'f';
```

plus `SELECT relname FROM pg_class ... relkind='r'`, and check every table is
either in the list or reaches it via FK. As of 2026-08-28 the only tables with
no FK at all are `RateLimitCounter`, `Service`, `Setting`, `User`,
`Testimonial`, `FaqItem`, `GalleryItem` — all explicitly named. A future
standalone table (no FK: an idempotency key store, an import job, a login-
attempt table) would be the first real gap.

Do **not** trust an ordering-dependent proof such as "the next test asserts
count === 0" — that only holds because `vitest.config.ts` sets
`fileParallelism: false` and tests run in file order.

Related: [[guard-authz-matrix-file-scan]],
[[invariant-audit-detail-no-patient-identity]]
