---
name: trap-createdat-tie-ordering
description: createdAt is timestamp(3) filled by Postgres CURRENT_TIMESTAMP — back-to-back inserts tie ~83% of the time, so orderBy createdAt alone is non-deterministic and any test relying on insert order is a coin flip
metadata:
  type: project
---

Every `createdAt` in this schema is `timestamp(3) without time zone DEFAULT
CURRENT_TIMESTAMP`. Measured on the local test DB: 49 of 59 consecutive
autocommit `INSERT`s landed in the **same millisecond**. `CURRENT_TIMESTAMP` is
also the *transaction* timestamp, so rows created in one transaction always tie.

**Why it matters:** `orderBy: { createdAt: "desc" }` with no secondary key
returns tied rows in physical heap order. Demonstrated with psql (BEGIN /
ROLLBACK): two tied rows came back A,B; after a single `UPDATE` on A — exactly
what `upsertPatient()` does — the same query returned B,A. So "the most recent
record wins" is not a real ordering.

**How to apply:** two consequences to check every audit.
1. Any `orderBy: { createdAt: ... }` that picks *one* row must carry an `id`
   tiebreak, as `src/app/api/admin/audit/route.ts` and
   `src/app/api/admin/patients/route.ts` already do.
2. A regression test that proves "the fix picks the right row" by creating the
   two rows back-to-back and relying on their creation order is only ~50%
   reliable against the reverted code. Force distinct `createdAt` values
   explicitly in the fixture. Related: [[guard-upsert-patient-phone-name]].
