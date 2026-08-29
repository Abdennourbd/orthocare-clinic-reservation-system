---
name: guard-merged-timeline-ordering
description: Any list route that merges two Prisma findMany results in TypeScript needs orderBy + a tiebreak on BOTH queries, or pagination over the union is non-deterministic
metadata:
  type: project
---

`GET /api/admin/patients/[id]/history` builds its timeline by merging
`appointment.findMany` and `visit.findMany` in TypeScript and slicing the merged
array for pagination. That construction has three ordering dependencies that a
single-page test never exercises.

**Why:** `Array.prototype.sort` is stable, so ties in the sort key fall back to
the order Postgres returned the rows in. A `findMany` without `orderBy` has no
guaranteed row order, and it changes after an `UPDATE` or a `VACUUM`. Ties are
not rare here: `visitCreateSchema.date` accepts a bare `YYYY-MM-DD`, which
becomes exactly midnight UTC — every visit recorded on the same day ties. Across
two page requests, a tied item can then appear twice or not at all, and a
clinician silently misses a treatment record.

**How to apply:** when auditing any merged-source list route, check three things:
(1) both `findMany` calls carry `orderBy` with an `id` tiebreak; (2) the
TypeScript comparator has its own deterministic tiebreak, not just the date;
(3) neither query is unbounded (`take`) if the union is paginated. Related:
[[trap_createdat_tie_ordering]].
