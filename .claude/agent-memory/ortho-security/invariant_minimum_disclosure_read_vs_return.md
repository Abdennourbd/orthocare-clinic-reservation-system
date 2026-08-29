---
name: invariant-minimum-disclosure-read-vs-return
description: Minimum disclosure has two halves — what the Prisma select reads and what the response literal returns; tests here usually only guard the second
metadata:
  type: project
---

In this codebase "minimum disclosure" is enforced twice and tested once.

1. **Read side** — the `select` / `where` handed to Prisma decides how many rows
   and which columns leave Postgres.
2. **Return side** — the explicit field literal in the `.map()` decides what
   reaches the caller.

**Why:** a test that asserts `Object.keys(result[0]).sort()` proves only the
second. It keeps passing if someone widens the `select` to include `notes` or
`email`, because the hand-built object literal filters them out anyway. Same
tautology class as the authz-matrix blind spots in
[[boundaries-authz-matrix-harness]]: the assertion is true by construction of
the code under test, so it can never fail.

**How to apply:** when a module claims a strict whitelist, assert on the
`select` constant itself (`expect(Object.keys(DUPLICATE_SELECT).sort()).toEqual(
[…])`) *in addition to* the response shape — that is the assertion that actually
mutates-to-red. Also ask the read-side question separately: does the query have
a `take`/`where` that bounds the rows, or does it materialise the whole table in
app memory? An unbounded `findMany` is a minimisation and availability finding
even when the returned fields are perfect. Note `Patient` already has
`@@index([phoneE164])`, so an exact-phone criterion never needs a full scan —
only accent-insensitive *name* matching does.
