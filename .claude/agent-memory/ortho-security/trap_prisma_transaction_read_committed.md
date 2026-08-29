---
name: trap-prisma-transaction-read-committed
description: Prisma $transaction() inherits Postgres READ COMMITTED — an in-transaction findUnique-then-update existence check is NOT mutual exclusion; how to disprove the "race-safe" comment in 30 seconds
metadata:
  type: project
---

`getPrisma().$transaction(async (tx) => ...)` with no `isolationLevel` option runs at
the Postgres default, **READ COMMITTED**. A `tx.model.findUnique()` guard followed by
`tx.model.update()` therefore does **not** serialize two concurrent callers: both read
the pre-state, the second `UPDATE` merely blocks on the row lock, then re-reads and
applies. Both transactions commit successfully.

**Why:** header comments in this repo repeatedly claim "checked inside the same
transaction, so a race can never double-write" (idempotence guards keyed on a nullable
timestamp column such as `Patient.anonymizedAt`). That claim is false as written, and a
future maintainer will trust the comment instead of the isolation level. The practical
damage is usually a duplicate `logAction()` row plus a re-stamped timestamp — small, but
the timestamp is often the legal proof of *when* something happened.

**How to apply:** whenever a diff adds an in-transaction "already done?" check, grep the
`$transaction(` call for a second argument. No `isolationLevel: "Serializable"` and no
`SELECT ... FOR UPDATE` (Prisma has no first-class API for it — it needs `$queryRaw`)
means the guard is advisory only. The correct fixes are a conditional write
(`updateMany({ where: { id, anonymizedAt: null } })` and branch on `.count === 0`), a
unique/partial index, or `isolationLevel: "Serializable"` with retry.

Proof takes two `psql` sessions against `TEST_DATABASE_URL` (write the .sql files to the
scratchpad, never into the repo): T1 `BEGIN; SELECT; UPDATE; pg_sleep(3); COMMIT;` and,
one second later, T2 `BEGIN; SELECT; UPDATE; COMMIT;`. Both report `UPDATE 1`. Delete the
probe row afterwards and confirm `git status --porcelain src/` is unchanged.

Related: [[invariant-audit-detail-no-patient-identity]], [[guard-erasure-surface-inventory]]
