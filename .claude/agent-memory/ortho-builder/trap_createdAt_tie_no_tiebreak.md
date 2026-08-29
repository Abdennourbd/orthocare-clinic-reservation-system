---
name: trap_createdAt_tie_no_tiebreak
description: orderBy createdAt desc with no tiebreak is nondeterministic on ties, and back-to-back test fixtures tie often enough to matter — always pair with id desc.
metadata:
  type: feedback
---

**The trap**: `Patient.createdAt` (and most timestamp columns in this schema)
is `timestamp(3)` — millisecond precision. Two rows inserted back-to-back
(e.g. in a test fixture, or two rapid API calls) frequently land in the same
millisecond — measured locally at 49/59 consecutive `INSERT` pairs tied.
`Prisma`'s `orderBy: { createdAt: "desc" }` with a tie then falls back to
Postgres physical row order, NOT insertion order — and an `UPDATE` on one of
the tied rows can silently change that physical order on the next query. Code
that resolves "the most recent match" this way (`findFirst`/`.find()` on a
`findMany` sorted only by `createdAt`) is effectively picking an arbitrary row
on ties, not the newest one.

**Why it matters**: found as a BLOCKING-adjacent defect in Task 13's
`upsertPatient()` (`src/lib/booking/createBooking.ts`) — see
[[project_task13_phone_sharing_fix]]. A test asserting recency-dependent
behavior with two fixture rows created back-to-back and no explicit
`createdAt` has roughly a coin-flip chance of passing even against the
buggy code, because the fixture itself ties as often as real inserts do.

**How to apply**:
- Any `orderBy: { createdAt: "desc" }` (or `"asc"`) that must be
  deterministic needs a tiebreak: `orderBy: [{ createdAt: "desc" }, { id:
  "desc" }]` — the convention already used by
  `src/app/api/admin/audit/route.ts` and
  `src/app/api/admin/patients/route.ts`.
- Any test fixture that creates two+ rows back-to-back and then asserts
  something order/recency-dependent needs an **explicit, distinct**
  `createdAt` on at least one row (e.g. `new Date(Date.now() - 60_000)` on
  the earlier one) — don't rely on wall-clock insertion order.
- To prove a guard-rail test actually bites (not just "usually" bites): run
  it 5+ times in a row against the unfixed code with a *fixed* fixture; if it
  doesn't fail every single time, the fixture (not just the code) is the bug.
