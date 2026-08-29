---
name: reference-take-vs-in-memory-break
description: A JS-side `break`/slice cap on a Prisma findMany result does NOT bound the query cost if there's no `take` — the whole result set is already fetched
metadata:
  type: reference
---

Recurring trap worth checking on any Prisma `findMany` in this codebase:
a constant like `MAX_RESULTS = 10` combined with a `for` loop that does
`if (matches.length >= MAX_RESULTS) break;` only bounds the **output** array.
`findMany()` without a `.take`/`.take` equivalent already materializes and
transfers the **entire** matching result set over the network before the loop
even starts — the `break` happens after the expensive part.

**Why it matters here**: seen in `src/lib/patients/duplicates.ts` (Task 13
step 3) — the original spec called for `take: 10` at the query level; the
implementation dropped the SQL filter (justified, see
[[project-plan-md-lags-task-relay-decisions]]) but also silently dropped the
query-level bound along with it, leaving only the output-level cap. Read
naively, `MAX_CANDIDATES = 10` looks like it bounds cost — it doesn't.

**How to apply**: whenever a diff removes a `take`/`limit` from a Prisma query
and replaces it with in-memory truncation, treat that as a distinct finding
from "the SQL filter changed" — ask whether the removed `take` was also doing
double duty as a cost bound, not just an output-shaping detail.
