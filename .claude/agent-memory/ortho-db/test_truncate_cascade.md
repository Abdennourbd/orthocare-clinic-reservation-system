---
name: test-truncate-cascade
description: tests/setup.ts TRUNCATE names tables explicitly but uses CASCADE — a new model with an FK to Patient/Appointment is cleaned automatically, no setup.ts edit needed
metadata:
  type: project
---

`tests/setup.ts` runs one `TRUNCATE TABLE "RateLimitCounter", "User", "Patient",
… RESTART IDENTITY CASCADE;` per test. The list is hand-written and does **not**
name every table, but `CASCADE` truncates any table holding an FK to a listed
one.

**Why:** editing `tests/setup.ts` is forbidden (`CLAUDE.md` — its localhost-only
guard is what keeps the `TRUNCATE` away from Neon), so a new model must not need
it. Verified 2026-08-28 when `Visit` was added: it is truncated through its FK to
`Patient` without being named.

**How to apply:** a new model that hangs off `Patient`, `Appointment`, `Service`
or `User` needs no change to the truncate list. Prove it in the model's schema
test with `expect(await prisma.<model>.count()).toBe(0)` at the start of a test
that runs *after* one which inserted rows. Only a model with **no** FK to a
listed table would need the user to add it — report it, never add it yourself.
See [[env-database-targets]].
